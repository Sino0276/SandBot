// SandBot STEP 변환기.
// occt-import-js(0.0.23)의 C++ 가져오기 코드와 같은 OCCT(7.6.1)를 네이티브로 빌드해, 렌더러 WASM과 같은 결과
// (노드 계층·메시 순서·메시별 면 순서)를 내되 WASM의 2 GB 메모리 한도 없이 변환한다.
// 메시 순서가 WASM과 같아야 프로젝트 파일의 형상 id(cadGeometryId)가 어느 쪽으로 읽어도 맞는다.
//
// 사용법: sandbot-step-converter <input.step | -> <output.bin>
//         sandbot-step-converter --version   (빌드 식별 정보 JSON. 앱이 실행 전에 확인한다)
//   입력이 "-"이면 표준 입력에서 읽는다. 앱은 캐시 키를 계산한 바로 그 바이트를 표준 입력으로 넘긴다
//   (파일을 두 번 읽는 사이에 바뀌어 다른 내용의 결과가 캐시되는 일이 없게).
// 진행 단계는 stderr에 "phase <read|transfer|mesh|write>" 줄로, 변환(transfer) 진행률은 "progress <0~1>" 줄로 알린다.
// OCCT가 예외를 삼켜 일부 형상이 빠졌으면 "warning untranslated <개수>" 줄을 쓴다(앱은 이 결과를 캐시하지 않는다).
// OCCT 환경 변수(CSF_*, CASROOT 등)는 시작할 때 지운다. 있으면 STEP 형상 보정·삼각분할 방식이 바뀌어 WASM과 결과가
// 달라질 수 있다(MMGT_*는 main 전에 읽히므로 앱이 실행할 때 환경에서 뺀다).
// 끝나기 직전 stderr 마지막 줄에 "result <ok|readFailed|outOfMemory|failed> [메시지]"를 쓴다. 앱은 이 줄로 결과를
// 판단하고, 이 줄 없이 끝났으면 비정상 종료로 본다(Windows CRT의 abort 코드 3, OCCT의 exit(1) 등과 섞이지 않게).
// 종료 코드(참고용, 64 이상): 0 성공, 64 사용법, 65 입력을 읽을 수 없음, 66 STEP으로 읽지 못함, 67 메모리 부족,
//           68 그 밖의 오류, 69 출력 파일을 쓸 수 없음, 70 앱(부모 프로세스)이 사라짐
//
// 출력 형식 SBSTEP01 (리틀 엔디언):
//   magic[8] "SBSTEP01" | u64 jsonOffset | u64 jsonLength | 메시 배열들 | JSON(UTF-8)
//   JSON: { "root": { name, meshes[], children[] }, "meshes": [{ name, color?, brep_faces,
//           vertexCount, normalCount, triangleCount, positionOffset, normalOffset, indexOffset }] }
//   positions f32[vertexCount*3], normals f32[normalCount*3](normalCount가 0이면 없음, offset -1),
//   indices u32[triangleCount*3]. 오프셋은 파일 처음부터의 바이트 위치이고 4의 배수다.

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <exception>
#include <new>
#include <string>
#include <vector>

#include "importer-utils.hpp"
#include "importer-xcaf.hpp"

#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Check.hxx>
#include <Interface_CheckIterator.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <Message_Printer.hxx>
#include <Message_PrinterOStream.hxx>
#include <Message_ProgressIndicator.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPControl_Reader.hxx>
#include <Standard_Failure.hxx>
#include <Standard_OutOfMemory.hxx>
#include <Transfer_TransientProcess.hxx>
#include <XSControl_TransferReader.hxx>
#include <XSControl_WorkSession.hxx>

#include <atomic>
#include <mutex>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#else
#include <cstdlib>
#include <unistd.h>
extern char** environ;
#endif
#if defined(__linux__)
#include <csignal>
#include <sys/prctl.h>
#elif defined(__APPLE__)
#include <chrono>
#include <thread>
#endif

namespace {

enum ExitCode {
    ExitOk = 0,
    ExitUsage = 64,
    ExitInputNotFound = 65,
    ExitReadFailed = 66,
    ExitOutOfMemory = 67,
    ExitFailed = 68,
    ExitWriteFailed = 69,
    ExitParentGone = 70
};

#ifndef SANDBOT_OCCT_IMPORT_JS_COMMIT
#define SANDBOT_OCCT_IMPORT_JS_COMMIT "unknown"
#endif
#ifndef SANDBOT_OCCT_COMMIT
#define SANDBOT_OCCT_COMMIT "unknown"
#endif
#ifndef SANDBOT_RESULT_FORMAT
#define SANDBOT_RESULT_FORMAT "unknown"
#endif

void ReportPhase (const char* phase)
{
    std::fprintf (stderr, "phase %s\n", phase);
    std::fflush (stderr);
}

void ReportError (const char* message)
{
    std::fprintf (stderr, "error %s\n", message);
    std::fflush (stderr);
}

// 마지막 줄: 앱이 결과를 판단하는 기준
int Finish (int exitCode)
{
    const char* status = "failed";
    switch (exitCode) {
        case ExitOk:
            status = "ok";
            break;
        case ExitReadFailed:
            status = "readFailed";
            break;
        case ExitOutOfMemory:
            status = "outOfMemory";
            break;
        default:
            break;
    }
    std::fprintf (stderr, "result %s\n", status);
    std::fflush (stderr);
    return exitCode;
}

// 앱이 죽어도 변환기가 남아 메모리를 차지하지 않게 한다(Windows는 Node가 job object로 함께 끝낸다)
void WatchParent ()
{
#if defined(__linux__)
    pid_t parent = getppid ();
    prctl (PR_SET_PDEATHSIG, SIGKILL);
    if (getppid () != parent) {
        _exit (ExitParentGone);
    }
#elif defined(__APPLE__)
    pid_t parent = getppid ();
    std::thread ([parent] () {
        while (true) {
            std::this_thread::sleep_for (std::chrono::seconds (1));
            if (getppid () != parent) {
                _exit (ExitParentGone);
            }
        }
    }).detach ();
#endif
}

#ifdef _WIN32
using PathString = std::wstring;
FILE* OpenFile (const PathString& path, const wchar_t* mode)
{
    return _wfopen (path.c_str (), mode);
}
#define READ_MODE L"rb"
#define WRITE_MODE L"wb"
#define VERSION_FLAG L"--version"
#else
using PathString = std::string;
FILE* OpenFile (const PathString& path, const char* mode)
{
    return std::fopen (path.c_str (), mode);
}
#define READ_MODE "rb"
#define WRITE_MODE "wb"
#define VERSION_FLAG "--version"
#endif

bool ReadAll (FILE* file, std::vector<std::uint8_t>& content)
{
    std::vector<std::uint8_t> buffer (1 << 20);
    size_t count = 0;
    while ((count = std::fread (buffer.data (), 1, buffer.size (), file)) > 0) {
        content.insert (content.end (), buffer.data (), buffer.data () + count);
    }
    return std::ferror (file) == 0;
}

// 경로는 OS 기본 문자열로 연다(Windows는 한글 경로를 위해 wide 문자열). "-"는 표준 입력.
bool ReadInput (const PathString& path, std::vector<std::uint8_t>& content)
{
    if (path.size () == 1 && path[0] == '-') {
#ifdef _WIN32
        _setmode (_fileno (stdin), _O_BINARY);
#endif
        return ReadAll (stdin, content);
    }
    FILE* file = OpenFile (path, READ_MODE);
    if (file == nullptr) {
        return false;
    }
    bool ok = ReadAll (file, content);
    std::fclose (file);
    return ok;
}

bool IsOcctVariable (const std::string& name)
{
    static const char* const prefixes[] = { "CSF_", "MMGT_", "CASROOT", "DRAW", "OCCT" };
    for (const char* prefix : prefixes) {
        if (name.compare (0, std::strlen (prefix), prefix) == 0) {
            return true;
        }
    }
    return false;
}

void ClearOcctEnvironment ()
{
#ifdef _WIN32
    // OCCT는 Windows에서 GetEnvironmentVariableW로 읽는다
    wchar_t* block = GetEnvironmentStringsW ();
    for (wchar_t* entry = block; entry != nullptr && *entry != L'\0'; entry += wcslen (entry) + 1) {
        std::wstring text (entry);
        size_t equals = text.find (L'=', 1);
        std::wstring name = text.substr (0, equals);
        std::string ascii (name.begin (), name.end ());
        if (IsOcctVariable (ascii)) {
            SetEnvironmentVariableW (name.c_str (), nullptr);
        }
    }
    if (block != nullptr) {
        FreeEnvironmentStringsW (block);
    }
#else
    std::vector<std::string> names;
    for (char** entry = environ; entry != nullptr && *entry != nullptr; entry++) {
        std::string text (*entry);
        std::string name = text.substr (0, text.find ('='));
        if (IsOcctVariable (name)) {
            names.push_back (name);
        }
    }
    for (const std::string& name : names) {
        unsetenv (name.c_str ());
    }
#endif
}

// OCCT는 메모리 부족(Standard_OutOfMemory)을 포함한 예외를 안에서 잡아 메시지로만 남긴다.
// 기본 출력(표준 출력)을 이 프린터로 바꿔, 실패 메시지는 stderr로 보내고 메모리 부족이 있었는지 기억한다.
std::atomic<bool> sawOutOfMemory (false);

class FailurePrinter : public Message_Printer
{
protected:
    virtual void send (const TCollection_AsciiString& theString, const Message_Gravity theGravity) const override
    {
        if (theGravity < Message_Fail) {
            return;
        }
        std::string text (theString.ToCString ());
        if (text.find ("OutOfMemory") != std::string::npos || text.find ("out of memory") != std::string::npos) {
            sawOutOfMemory = true;
        }
        static std::atomic<int> printed (0);
        if (printed++ < 20) {
            std::replace (text.begin (), text.end (), '\n', ' ');
            std::replace (text.begin (), text.end (), '\r', ' ');
            std::fprintf (stderr, "occt %s\n", text.substr (0, 300).c_str ());
            std::fflush (stderr);
        }
    }
};

// 변환(transfer) 진행률. 1% 이상 바뀔 때만 알린다.
class StderrProgress : public Message_ProgressIndicator
{
public:
    virtual void Show (const Message_ProgressScope&, const Standard_Boolean isForce) override
    {
        std::lock_guard<std::mutex> lock (mutex);
        double position = GetPosition ();
        if (!isForce && position - lastShown < 0.01) {
            return;
        }
        lastShown = position;
        std::fprintf (stderr, "progress %.3f\n", position);
        std::fflush (stderr);
    }

private:
    std::mutex mutex;
    double lastShown = -1.0;
};

// occt-import-js의 ImporterStep::TransferToDocument와 같은 호출 순서(진행률 표시는 결과에 영향이 없다).
// 읽기와 변환 사이에 진행 단계를 알리고, 다 읽은 STEP 내용은 변환 전에 메모리에서 내린다.
class ImporterStepWithProgress : public ImporterXcaf
{
public:
    explicit ImporterStepWithProgress (std::vector<std::uint8_t>& input) : input (input)
    {
    }

    bool ReadFailed () const
    {
        return readFailed;
    }

    // 예외로 변환하지 못하고 건너뛴 STEP 엔티티 수
    int Untranslated () const
    {
        return untranslated;
    }

private:
    virtual bool TransferToDocument (const std::vector<std::uint8_t>& fileContent) override
    {
        STEPCAFControl_Reader stepCafReader;
        stepCafReader.SetColorMode (true);
        stepCafReader.SetNameMode (true);

        STEPControl_Reader& stepReader = stepCafReader.ChangeReader ();
        std::string dummyFileName = "stp";
        {
            VectorBuffer inputBuffer (fileContent);
            std::istream inputStream (&inputBuffer);
            ReportPhase ("read");
            IFSelect_ReturnStatus readStatus = stepReader.ReadStream (dummyFileName.c_str (), inputStream);
            if (readStatus != IFSelect_RetDone) {
                readFailed = true;
                return false;
            }
        }
        // 읽은 내용은 모델로 옮겨졌다. 변환 동안 원본(수백 MB)을 들고 있지 않는다.
        std::vector<std::uint8_t> ().swap (input);

        ReportPhase ("transfer");
        Handle (StderrProgress) progress = new StderrProgress ();
        bool transferred = stepCafReader.Transfer (document, progress->Start ());
        untranslated = CountUntranslated (stepReader);
        return transferred;
    }

    static int CountUntranslated (STEPControl_Reader& stepReader)
    {
        Handle (XSControl_WorkSession) session = stepReader.WS ();
        if (session.IsNull () || session->TransferReader ().IsNull ()) {
            return 0;
        }
        const Handle (Transfer_TransientProcess)& process = session->TransferReader ()->TransientProcess ();
        if (process.IsNull ()) {
            return 0;
        }
        int count = 0;
        Interface_CheckIterator checks = process->CheckList (Standard_True);
        for (checks.Start (); checks.More (); checks.Next ()) {
            const Handle (Interface_Check)& check = checks.Value ();
            for (Standard_Integer i = 1; i <= check->NbFails (); i++) {
                if (std::strstr (check->CFail (i), "Exception is raised") != nullptr) {
                    count += 1;
                }
            }
        }
        return count;
    }

    std::vector<std::uint8_t>& input;
    bool readFailed = false;
    int untranslated = 0;
};

// JSON 문자열. 잘못된 UTF-8은 U+FFFD로 바꾼다(브라우저 TextDecoder가 WASM 결과를 읽을 때와 같게).
void AppendJsonString (std::string& out, const std::string& value)
{
    out += '"';
    const unsigned char* bytes = reinterpret_cast<const unsigned char*> (value.data ());
    size_t length = value.size ();
    size_t i = 0;
    while (i < length) {
        unsigned char c = bytes[i];
        if (c < 0x80) {
            if (c == '"') {
                out += "\\\"";
            } else if (c == '\\') {
                out += "\\\\";
            } else if (c < 0x20) {
                char escaped[8];
                std::snprintf (escaped, sizeof (escaped), "\\u%04x", c);
                out += escaped;
            } else {
                out += static_cast<char> (c);
            }
            i += 1;
            continue;
        }
        // 다중 바이트 UTF-8 검사(과잉 표현·서로게이트·범위 밖 거부)
        size_t need = 0;
        std::uint32_t codePoint = 0;
        std::uint32_t minimum = 0;
        if (c >= 0xC2 && c <= 0xDF) {
            need = 1;
            codePoint = c & 0x1F;
            minimum = 0x80;
        } else if (c >= 0xE0 && c <= 0xEF) {
            need = 2;
            codePoint = c & 0x0F;
            minimum = 0x800;
        } else if (c >= 0xF0 && c <= 0xF4) {
            need = 3;
            codePoint = c & 0x07;
            minimum = 0x10000;
        }
        // 뒤따르는 바이트가 모두 있어야 한다
        bool valid = need > 0 && i + need < length;
        if (valid) {
            for (size_t k = 1; k <= need; k++) {
                if ((bytes[i + k] & 0xC0) != 0x80) {
                    valid = false;
                    break;
                }
                codePoint = (codePoint << 6) | (bytes[i + k] & 0x3F);
            }
        }
        if (valid && (codePoint < minimum || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF))) {
            valid = false;
        }
        if (valid) {
            out.append (value, i, need + 1);
            i += need + 1;
        } else {
            out += "\xEF\xBF\xBD";
            i += 1;
        }
    }
    out += '"';
}

void AppendNumber (std::string& out, double value)
{
    char buffer[32];
    std::snprintf (buffer, sizeof (buffer), "%.17g", value);
    out += buffer;
}

void AppendInteger (std::string& out, long long value)
{
    out += std::to_string (value);
}

void AppendColor (std::string& out, const Color& color)
{
    out += '[';
    AppendNumber (out, color.r);
    out += ',';
    AppendNumber (out, color.g);
    out += ',';
    AppendNumber (out, color.b);
    out += ']';
}

class OutputFile
{
public:
    explicit OutputFile (FILE* file) : file (file), offset (0), failed (false)
    {
    }

    void Write (const void* data, size_t size)
    {
        if (failed || size == 0) {
            return;
        }
        if (std::fwrite (data, 1, size, file) != size) {
            failed = true;
        }
        offset += size;
    }

    std::uint64_t Offset () const
    {
        return offset;
    }

    bool Failed () const
    {
        return failed;
    }

private:
    FILE* file;
    std::uint64_t offset;
    bool failed;
};

void WriteU64 (OutputFile& output, std::uint64_t value)
{
    unsigned char bytes[8];
    for (int i = 0; i < 8; i++) {
        bytes[i] = static_cast<unsigned char> ((value >> (8 * i)) & 0xFF);
    }
    output.Write (bytes, sizeof (bytes));
}

// 리틀 엔디언 플랫폼(x86-64, arm64)만 지원한다
static_assert (sizeof (float) == 4, "float must be 32-bit");

// occt-import-js js-interface.cpp의 HierarchyWriter와 같은 순서로 노드와 메시를 쓴다.
// 메시 배열은 메시 하나씩 바로 파일에 쓰고, 계층과 메시 정보는 JSON으로 모아 마지막에 쓴다.
class HierarchyWriter
{
public:
    explicit HierarchyWriter (OutputFile& output) : output (output), meshCount (0)
    {
        meshesJson += '[';
    }

    void WriteNode (const NodePtr& node, std::string& nodeJson, bool isRoot)
    {
        nodeJson += "{\"name\":";
        AppendJsonString (nodeJson, node->GetName ());

        nodeJson += ",\"meshes\":[";
        WriteMeshes (node, nodeJson);
        nodeJson += ']';

        // 루트의 GetChildren이 각 최상위 형상을 삼각분할한다(occt-import-js의 XcafRootNode)
        if (isRoot) {
            ReportPhase ("mesh");
        }
        std::vector<NodePtr> children = node->GetChildren ();
        nodeJson += ",\"children\":[";
        for (size_t childIndex = 0; childIndex < children.size (); childIndex++) {
            if (childIndex > 0) {
                nodeJson += ',';
            }
            WriteNode (children[childIndex], nodeJson, false);
        }
        nodeJson += "]}";
    }

    std::string MeshesJson () const
    {
        return meshesJson + ']';
    }

private:
    void WriteMeshes (const NodePtr& node, std::string& nodeJson)
    {
        if (!node->IsMeshNode ()) {
            return;
        }

        int nodeMeshCount = 0;
        node->EnumerateMeshes ([&] (const Mesh& mesh) {
            positions.clear ();
            normals.clear ();
            indices.clear ();
            std::string brepFacesJson = "[";

            std::uint32_t vertexCount = 0;
            std::uint32_t normalCount = 0;
            std::uint32_t triangleCount = 0;
            std::uint32_t brepFaceCount = 0;

            mesh.EnumerateFaces ([&] (const Face& face) {
                std::uint32_t triangleOffset = triangleCount;
                std::uint32_t vertexOffset = vertexCount;
                face.EnumerateVertices ([&] (double x, double y, double z) {
                    positions.push_back (static_cast<float> (x));
                    positions.push_back (static_cast<float> (y));
                    positions.push_back (static_cast<float> (z));
                    vertexCount += 1;
                });
                face.EnumerateNormals ([&] (double x, double y, double z) {
                    normals.push_back (static_cast<float> (x));
                    normals.push_back (static_cast<float> (y));
                    normals.push_back (static_cast<float> (z));
                    normalCount += 1;
                });
                face.EnumerateTriangles ([&] (int v0, int v1, int v2) {
                    indices.push_back (vertexOffset + static_cast<std::uint32_t> (v0));
                    indices.push_back (vertexOffset + static_cast<std::uint32_t> (v1));
                    indices.push_back (vertexOffset + static_cast<std::uint32_t> (v2));
                    triangleCount += 1;
                });
                if (brepFaceCount > 0) {
                    brepFacesJson += ',';
                }
                // triangleCount가 0인 면은 last가 first - 1이 된다(WASM과 같음)
                brepFacesJson += "{\"first\":";
                AppendInteger (brepFacesJson, triangleOffset);
                brepFacesJson += ",\"last\":";
                AppendInteger (brepFacesJson, static_cast<long long> (triangleCount) - 1);
                brepFacesJson += ",\"color\":";
                Color faceColor;
                if (face.GetColor (faceColor)) {
                    AppendColor (brepFacesJson, faceColor);
                } else {
                    brepFacesJson += "null";
                }
                brepFacesJson += '}';
                brepFaceCount += 1;
            });
            brepFacesJson += ']';

            // 법선은 정점마다 있을 때만 쓴다(WASM과 같음)
            bool hasNormals = vertexCount == normalCount;
            std::uint64_t positionOffset = output.Offset ();
            output.Write (positions.data (), positions.size () * sizeof (float));
            long long normalOffset = -1;
            if (hasNormals) {
                normalOffset = static_cast<long long> (output.Offset ());
                output.Write (normals.data (), normals.size () * sizeof (float));
            }
            std::uint64_t indexOffset = output.Offset ();
            output.Write (indices.data (), indices.size () * sizeof (std::uint32_t));

            if (meshCount > 0) {
                meshesJson += ',';
            }
            meshesJson += "{\"name\":";
            AppendJsonString (meshesJson, mesh.GetName ());
            Color meshColor;
            if (mesh.GetColor (meshColor)) {
                meshesJson += ",\"color\":";
                AppendColor (meshesJson, meshColor);
            }
            meshesJson += ",\"brep_faces\":";
            meshesJson += brepFacesJson;
            meshesJson += ",\"vertexCount\":";
            AppendInteger (meshesJson, vertexCount);
            meshesJson += ",\"normalCount\":";
            AppendInteger (meshesJson, hasNormals ? normalCount : 0);
            meshesJson += ",\"triangleCount\":";
            AppendInteger (meshesJson, triangleCount);
            meshesJson += ",\"positionOffset\":";
            AppendInteger (meshesJson, static_cast<long long> (positionOffset));
            meshesJson += ",\"normalOffset\":";
            AppendInteger (meshesJson, normalOffset);
            meshesJson += ",\"indexOffset\":";
            AppendInteger (meshesJson, static_cast<long long> (indexOffset));
            meshesJson += '}';

            if (nodeMeshCount > 0) {
                nodeJson += ',';
            }
            AppendInteger (nodeJson, meshCount);
            meshCount += 1;
            nodeMeshCount += 1;
        });
    }

    OutputFile& output;
    int meshCount;
    std::string meshesJson;
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<std::uint32_t> indices;
};

int Convert (const PathString& inputPath, const PathString& outputPath)
{
    std::vector<std::uint8_t> content;
    if (!ReadInput (inputPath, content)) {
        ReportError ("cannot read input file");
        return ExitInputNotFound;
    }

    // WASM 쪽(stepWorker.ts)과 같은 파라미터: 미터, 나머지는 기본값
    ImportParams params;
    params.linearUnit = ImportParams::LinearUnit::Meter;

    ImporterStepWithProgress importer (content);
    Importer::Result result = importer.LoadFile (content, params);
    std::vector<std::uint8_t> ().swap (content);
    if (result != Importer::Result::Success) {
        // OCCT가 메모리 부족을 잡아 읽기 실패로 끝낸 경우를 구분한다
        if (sawOutOfMemory) {
            ReportError ("out of memory");
            return ExitOutOfMemory;
        }
        ReportError (importer.ReadFailed () ? "cannot read STEP" : "cannot transfer STEP");
        return ExitReadFailed;
    }
    if (importer.Untranslated () > 0) {
        std::fprintf (stderr, "warning untranslated %d\n", importer.Untranslated ());
        std::fflush (stderr);
    }

    FILE* file = OpenFile (outputPath, WRITE_MODE);
    if (file == nullptr) {
        ReportError ("cannot open output file");
        return ExitWriteFailed;
    }
    OutputFile output (file);
    output.Write ("SBSTEP01", 8);
    WriteU64 (output, 0);
    WriteU64 (output, 0);

    HierarchyWriter writer (output);
    std::string rootJson;
    writer.WriteNode (importer.GetRootNode (), rootJson, true);

    ReportPhase ("write");
    std::string json = "{\"root\":" + rootJson + ",\"meshes\":" + writer.MeshesJson () + "}";
    std::uint64_t jsonOffset = output.Offset ();
    output.Write (json.data (), json.size ());

    bool ok = !output.Failed ();
    if (ok && std::fseek (file, 8, SEEK_SET) == 0) {
        OutputFile header (file);
        WriteU64 (header, jsonOffset);
        WriteU64 (header, json.size ());
        ok = !header.Failed ();
    } else {
        ok = false;
    }
    if (std::fclose (file) != 0) {
        ok = false;
    }
    if (!ok) {
        ReportError ("cannot write output file");
        return ExitWriteFailed;
    }
    return ExitOk;
}

int Run (const PathString& inputPath, const PathString& outputPath)
{
    try {
        return Convert (inputPath, outputPath);
    } catch (const std::bad_alloc&) {
        ReportError ("out of memory");
        return ExitOutOfMemory;
    } catch (const Standard_OutOfMemory& failure) {
        ReportError (failure.GetMessageString ());
        return ExitOutOfMemory;
    } catch (const Standard_Failure& failure) {
        ReportError (failure.GetMessageString ());
        return ExitFailed;
    } catch (const std::exception& exception) {
        ReportError (exception.what ());
        return ExitFailed;
    } catch (...) {
        ReportError ("unknown error");
        return ExitFailed;
    }
}

}  // namespace

#ifdef _WIN32
int wmain (int argc, wchar_t** argv)
#else
int main (int argc, char** argv)
#endif
{
    if (argc == 2 && PathString (argv[1]) == PathString (VERSION_FLAG)) {
        std::printf ("{\"format\":\"%s\",\"occtImportJs\":\"%s\",\"occt\":\"%s\"}\n",
            SANDBOT_RESULT_FORMAT, SANDBOT_OCCT_IMPORT_JS_COMMIT, SANDBOT_OCCT_COMMIT);
        return ExitOk;
    }
    if (argc != 3) {
        ReportError ("usage: sandbot-step-converter <input.step | -> <output.bin>");
        return Finish (ExitUsage);
    }
    WatchParent ();
    ClearOcctEnvironment ();
    // OCCT 메시지는 표준 출력 대신 stderr의 실패 줄로(메모리 부족 감지)
    Message::DefaultMessenger ()->RemovePrinters (STANDARD_TYPE (Message_PrinterOStream));
    Message::DefaultMessenger ()->AddPrinter (new FailurePrinter ());
    return Finish (Run (argv[1], argv[2]));
}
