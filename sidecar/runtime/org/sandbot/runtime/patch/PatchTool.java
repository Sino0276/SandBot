package org.sandbot.runtime.patch;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * 빌드 도구(T의 build-sidecar)가 쓰는 명령: 클래스 파일 트리를 패치해 복사한다.
 *
 * <pre>
 * java -cp sandbot-runtime.jar org.sandbot.runtime.patch.PatchTool [--classpath &lt;경로&gt;] [--verbose] &lt;inDir&gt; &lt;outDir&gt;
 * </pre>
 *
 * <ul>
 *   <li>inDir 아래 모든 파일을 같은 상대 경로로 outDir에 쓴다. .class는 ClassPatcher로 바꾸고(바뀐 것이 없으면 그대로),
 *       나머지 파일과 module-info.class는 그대로 복사한다. inDir과 outDir이 같아도 된다(제자리 패치).
 *   <li>상속 관계(Worker extends Thread의 Worker.sleep 등)는 inDir의 클래스, --classpath의 폴더·jar(경로 구분자로 여럿),
 *       JDK 순서로 찾는다.
 *   <li>출력(표준 출력, 한 줄씩): --verbose면 바꾼 클래스마다 {@code PATCHED <상대 경로> <바꾼 대상,…>},
 *       패치하지 못한 클래스마다 {@code FAILED <상대 경로>: <이유>}(그 클래스는 outDir에 쓰지 않는다),
 *       마지막에 {@code SUMMARY classes=N patched=N unchanged=N failed=N copied=N}.
 *   <li>종료 코드: 0 성공, 1 패치하지 못한 클래스가 있음(나머지는 썼다), 2 사용법·입출력 오류.
 * </ul>
 */
public final class PatchTool {
    private PatchTool() {}

    public static void main(String[] args) {
        System.exit(run(args, System.out, System.err));
    }

    static int run(String[] args, PrintStream out, PrintStream err) {
        boolean verbose = false;
        String classpath = null;
        List<String> positional = new ArrayList<>();
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.equals("--verbose")) verbose = true;
            else if (a.equals("--classpath") && i + 1 < args.length) classpath = args[++i];
            else if (a.startsWith("--")) return usage(err, "unknown option " + a);
            else positional.add(a);
        }
        if (positional.size() != 2) return usage(err, "expected <inDir> <outDir>");
        Path in = Paths.get(positional.get(0)).toAbsolutePath().normalize();
        Path outDir = Paths.get(positional.get(1)).toAbsolutePath().normalize();
        if (!Files.isDirectory(in)) return usage(err, "not a directory: " + in);

        List<ZipFile> jars = new ArrayList<>();
        try {
            List<Path> files = new ArrayList<>();
            try (Stream<Path> walk = Files.walk(in)) {
                walk.filter(Files::isRegularFile).forEach(files::add);
            }
            Collections.sort(files);
            Map<String, byte[]> classes = new HashMap<>();
            Map<Path, byte[]> contents = new HashMap<>();
            for (Path f : files) {
                byte[] bytes = Files.readAllBytes(f);
                contents.put(f, bytes);
                String rel = relative(in, f);
                if (rel.endsWith(".class")) classes.put(rel.substring(0, rel.length() - ".class".length()), bytes);
            }
            ClassHierarchy hierarchy = ClassHierarchy.ofClassFiles(classes);
            if (classpath != null) hierarchy = ClassHierarchy.chain(hierarchy, ofClasspath(classpath, jars));
            hierarchy = ClassHierarchy.chain(hierarchy, ClassHierarchy.ofClassLoader(ClassLoader.getPlatformClassLoader()));
            ClassPatcher patcher = new ClassPatcher(hierarchy);

            int classCount = 0, patched = 0, unchanged = 0, failed = 0, copied = 0;
            for (Path f : files) {
                String rel = relative(in, f);
                byte[] bytes = contents.get(f);
                Path target = outDir.resolve(rel);
                if (!rel.endsWith(".class") || rel.endsWith("module-info.class")) {
                    write(target, bytes);
                    copied++;
                    continue;
                }
                classCount++;
                try {
                    ClassPatcher.Result result = patcher.apply(bytes);
                    write(target, result.bytes);
                    if (result.changed()) {
                        patched++;
                        if (verbose) out.println("PATCHED " + rel + " " + String.join(",", result.redirected));
                    } else {
                        unchanged++;
                    }
                } catch (PatchException e) {
                    failed++;
                    out.println("FAILED " + rel + ": " + e.getMessage());
                    if (in.equals(outDir)) Files.deleteIfExists(target);
                }
            }
            out.println("SUMMARY classes=" + classCount + " patched=" + patched + " unchanged=" + unchanged
                    + " failed=" + failed + " copied=" + copied);
            out.flush();
            return failed == 0 ? 0 : 1;
        } catch (IOException e) {
            err.println("PatchTool: " + e);
            return 2;
        } finally {
            for (ZipFile z : jars) {
                try {
                    z.close();
                } catch (IOException ignored) {
                    // 닫기 실패는 결과와 관계없다
                }
            }
        }
    }

    private static int usage(PrintStream err, String problem) {
        err.println("PatchTool: " + problem);
        err.println("usage: PatchTool [--classpath <path>] [--verbose] <inDir> <outDir>");
        return 2;
    }

    private static String relative(Path root, Path file) {
        return root.relativize(file).toString().replace(File.separatorChar, '/');
    }

    private static void write(Path target, byte[] bytes) throws IOException {
        Path parent = target.getParent();
        if (parent != null) Files.createDirectories(parent);
        Files.write(target, bytes);
    }

    /** --classpath의 폴더·jar에서 클래스 파일을 그때그때 읽는 상속 관계 */
    private static ClassHierarchy ofClasspath(String classpath, List<ZipFile> jars) throws IOException {
        List<Path> dirs = new ArrayList<>();
        List<ZipFile> zips = new ArrayList<>();
        for (String entry : classpath.split(File.pathSeparator)) {
            if (entry.isEmpty()) continue;
            Path p = Paths.get(entry);
            if (Files.isDirectory(p)) dirs.add(p);
            else if (Files.isRegularFile(p)) {
                ZipFile z = new ZipFile(p.toFile(), StandardCharsets.UTF_8);
                zips.add(z);
                jars.add(z);
            }
        }
        Map<String, byte[]> lazy = new HashMap<String, byte[]>() {
            @Override
            public byte[] get(Object key) {
                String name = (String) key;
                if (containsKey(name)) return super.get(name);
                byte[] found = null;
                try {
                    for (Path d : dirs) {
                        Path f = d.resolve(name + ".class");
                        if (Files.isRegularFile(f)) {
                            found = Files.readAllBytes(f);
                            break;
                        }
                    }
                    if (found == null) {
                        for (ZipFile z : zips) {
                            ZipEntry e = z.getEntry(name + ".class");
                            if (e == null) continue;
                            try (InputStream s = z.getInputStream(e)) {
                                found = s.readAllBytes();
                            }
                            break;
                        }
                    }
                } catch (IOException e) {
                    found = null;
                }
                put(name, found);
                return found;
            }
        };
        return ClassHierarchy.ofClassFiles(lazy);
    }
}
