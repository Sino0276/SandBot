# SandBot STEP 변환기(네이티브). occt-import-js 0.0.23의 C++ 가져오기 코드와 OCCT 7.6.1을 고치지 않고 그대로 빌드한다.
# 소스 준비와 빌드는 scripts/build-step-converter.mjs가 한다(OCCT_IMPORT_JS_DIR에 occt 하위 폴더까지 받은 소스).
cmake_minimum_required (VERSION 3.19)

# Windows는 C++ 런타임을 정적으로 넣어 실행 파일 하나로 배포한다.
# occt-import-js의 CMakeLists는 cmake_minimum_required(3.6)이라 이 정책이 설정되지 않으므로 기본값으로 켠다.
set (CMAKE_POLICY_DEFAULT_CMP0091 NEW)
cmake_policy (SET CMP0091 NEW)
set (CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# macOS: Electron 39가 지원하는 가장 낮은 버전(12)에서도 실행되게
set (CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "최소 macOS 버전")

project (SandbotStepConverter CXX)

# 빌드 식별 정보(--version). 앱(src/main/stepConverter.ts)이 같은 version.json과 비교해, 렌더러 WASM과 다른
# 소스로 빌드한 변환기는 쓰지 않는다.
file (READ "${CMAKE_CURRENT_SOURCE_DIR}/version.json" SANDBOT_VERSION_JSON)
string (JSON SANDBOT_RESULT_FORMAT GET "${SANDBOT_VERSION_JSON}" format)
string (JSON SANDBOT_OCCT_IMPORT_JS_COMMIT GET "${SANDBOT_VERSION_JSON}" occtImportJs commit)
string (JSON SANDBOT_OCCT_COMMIT GET "${SANDBOT_VERSION_JSON}" occt commit)

set (OCCT_IMPORT_JS_DIR "" CACHE PATH "occt-import-js 0.0.23 소스 폴더(occt 하위 폴더에 OCCT 7.6.1)")
if (NOT EXISTS "${OCCT_IMPORT_JS_DIR}/occt-import-js/src/importer.hpp" OR NOT EXISTS "${OCCT_IMPORT_JS_DIR}/occt/src/Standard/Standard.hxx")
	message (FATAL_ERROR "OCCT_IMPORT_JS_DIR에 occt-import-js와 OCCT 소스가 없습니다: ${OCCT_IMPORT_JS_DIR}")
endif ()

# 가져오기 코드와 OCCT를 정적 라이브러리 OcctImportJS로 빌드한다(예제 실행 파일은 빌드하지 않음)
add_subdirectory ("${OCCT_IMPORT_JS_DIR}" occt-import-js EXCLUDE_FROM_ALL)

# occt-import-js 0.0.23의 importer.hpp는 <cstdint>를 직접 포함하지 않아 GCC 13 이상에서 컴파일되지 않는다.
# 소스를 고치지 않고 강제 포함으로 해결한다(C++ 파일만. OCCT에는 C 파일도 몇 개 있다). OCCT의 오래된 코드가 내는 경고는 끈다.
if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
	target_compile_options (OcctImportJS PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:SHELL:-include cstdint>" -w)
endif ()
# WASM에는 FMA가 없다. FMA가 있는 대상(arm64)에서 곱셈·덧셈을 합치면 삼각분할 결정이 달라질 수 있어 끈다.
# (x86-64 기본 대상은 FMA를 쓰지 않는다)
if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang" AND (APPLE OR CMAKE_SYSTEM_PROCESSOR MATCHES "arm|aarch64"))
	target_compile_options (OcctImportJS PRIVATE -ffp-contract=off)
endif ()
if (MINGW)
	# OCCT의 일부 오브젝트 파일은 섹션 수 한도를 넘는다
	target_compile_options (OcctImportJS PRIVATE -Wa,-mbig-obj)
endif ()
if (MSVC)
	target_compile_options (OcctImportJS PRIVATE /bigobj /w)
endif ()

add_executable (sandbot-step-converter src/main.cpp)
target_compile_definitions (sandbot-step-converter PRIVATE
	SANDBOT_RESULT_FORMAT="${SANDBOT_RESULT_FORMAT}"
	SANDBOT_OCCT_IMPORT_JS_COMMIT="${SANDBOT_OCCT_IMPORT_JS_COMMIT}"
	SANDBOT_OCCT_COMMIT="${SANDBOT_OCCT_COMMIT}")
set_target_properties (sandbot-step-converter PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
target_include_directories (sandbot-step-converter PRIVATE "${OCCT_IMPORT_JS_DIR}/occt-import-js/src")
if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
	# OCCT 헤더가 C++17에서 내는 사용 중단 경고는 끈다
	target_compile_options (sandbot-step-converter PRIVATE -Wno-deprecated-declarations)
endif ()
target_link_libraries (sandbot-step-converter PRIVATE OcctImportJS)

if (WIN32)
	# WASM은 스택 10 MB로 빌드됐다. Windows 기본 스택(1~2 MB)으로는 깊은 형상에서 넘칠 수 있어 16 MB로 늘린다.
	if (MINGW)
		# wmain(한글 경로) 사용, 런타임 DLL 없이 실행되게 정적 링크
		target_link_options (sandbot-step-converter PRIVATE -municode -static -Wl,--stack,16777216)
	elseif (MSVC)
		target_link_options (sandbot-step-converter PRIVATE /STACK:16777216)
	endif ()
elseif (APPLE)
	target_link_libraries (sandbot-step-converter PRIVATE "-framework Foundation")
else ()
	find_package (Threads REQUIRED)
	target_link_libraries (sandbot-step-converter PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
	# 배포할 때 libstdc++ 버전 차이로 실행되지 않는 일이 없게 정적으로 넣는다
	target_link_options (sandbot-step-converter PRIVATE -static-libstdc++ -static-libgcc)
endif ()
