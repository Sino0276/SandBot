package org.sandbot.runtime;

import org.sandbot.runtime.patch.ClassHierarchy;
import org.sandbot.testing.Check;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;

/**
 * LibraryClassLoader·LibraryJars·ClassHierarchy.ofJars(라이브러리 L1 §D-1): 라이브러리 jar의 클래스를 패치해 정의하는지(시간 API가 가상
 * 시계, 해시 순서 컬렉션이 삽입 순서), 멀티 릴리스 jar는 실행 JDK의 판, 리소스는 jar에서, 서명 파일은 무시, 부모(앱 로더) 우선,
 * 패치하지 못한 클래스는 정의하지 않음, 팀 클래스가 라이브러리의 Thread 하위 클래스를 상속해 부르는 sleep도 바뀌는지.
 */
public final class LibraryLoaderTest {
    private LibraryLoaderTest() {}

    private static final long MS = 1_000_000L;

    /** 소스(이름 → 글자)를 --release 8로 컴파일해 바이너리 이름 → 클래스 파일 */
    private static Map<String, byte[]> compile(Map<String, String> sources, List<String> classpath) throws IOException {
        Path src = Files.createTempDirectory("sandbot-lib-src");
        Path out = Files.createTempDirectory("sandbot-lib-out");
        List<String> args = new ArrayList<>(Arrays.asList("--release", "8", "-Xlint:-options", "-nowarn", "-proc:none",
                "-d", out.toString()));
        if (!classpath.isEmpty()) {
            args.add("-cp");
            args.add(String.join(File.pathSeparator, classpath));
        }
        for (Map.Entry<String, String> e : sources.entrySet()) {
            Path file = src.resolve(e.getKey().replace('.', '/') + ".java");
            Files.createDirectories(file.getParent());
            Files.write(file, e.getValue().getBytes(StandardCharsets.UTF_8));
            args.add(file.toString());
        }
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        ByteArrayOutputStream errors = new ByteArrayOutputStream();
        int code = javac.run(null, null, errors, args.toArray(new String[0]));
        if (code != 0) throw new IOException("javac failed: " + errors);
        Map<String, byte[]> classes = new LinkedHashMap<>();
        try (java.util.stream.Stream<Path> walk = Files.walk(out)) {
            for (Path p : (Iterable<Path>) walk.filter(Files::isRegularFile)::iterator) {
                String rel = out.relativize(p).toString().replace(File.separatorChar, '/');
                classes.put(rel.substring(0, rel.length() - ".class".length()).replace('/', '.'), Files.readAllBytes(p));
            }
        }
        return classes;
    }

    /** jar 하나를 쓴다(entries: 경로 → 바이트, 순서대로). multiRelease면 매니페스트에 Multi-Release: true. */
    private static Path jar(Map<String, byte[]> entries, boolean multiRelease) throws IOException {
        Path file = Files.createTempFile("sandbot-lib", ".jar");
        Manifest manifest = new Manifest();
        manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        if (multiRelease) manifest.getMainAttributes().put(new Attributes.Name("Multi-Release"), "true");
        manifest.getMainAttributes().put(Attributes.Name.IMPLEMENTATION_VERSION, "4.5.6");
        try (OutputStream stream = Files.newOutputStream(file); JarOutputStream out = new JarOutputStream(stream, manifest)) {
            for (Map.Entry<String, byte[]> e : entries.entrySet()) {
                out.putNextEntry(new JarEntry(e.getKey()));
                out.write(e.getValue());
                out.closeEntry();
            }
        }
        return file;
    }

    private static Map<String, byte[]> classEntries(Map<String, byte[]> classes) {
        Map<String, byte[]> out = new LinkedHashMap<>();
        for (Map.Entry<String, byte[]> e : classes.entrySet()) out.put(e.getKey().replace('.', '/') + ".class", e.getValue());
        return out;
    }

    private static LibraryClassLoader loader(Path... jars) throws IOException {
        List<String> paths = new ArrayList<>();
        for (Path p : jars) paths.add(p.toString());
        return new LibraryClassLoader(LibraryJars.open(paths), LibraryLoaderTest.class.getClassLoader());
    }

    private static Object callStatic(ClassLoader loader, String className, String method) throws Exception {
        try {
            return Class.forName(className, true, loader).getMethod(method).invoke(null);
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof Exception) throw (Exception) e.getCause();
            throw e;
        }
    }

    private static final String WORKER = "package lib; public class Worker extends Thread {"
            + " public static long now() { return System.nanoTime(); }"
            + " public static String order() { java.util.Map<Thread.State, Integer> m = new java.util.HashMap<>();"
            + "  for (Thread.State s : Thread.State.values()) m.put(s, s.ordinal()); return m.keySet().toString(); } }";

    public static void testLibraryClassesArePatched() throws Exception {
        Map<String, byte[]> classes = compile(Collections.singletonMap("lib.Worker", WORKER), Collections.emptyList());
        try (LibraryClassLoader loader = loader(jar(classEntries(classes), false))) {
            TestSim.fresh().sleep(7 * MS);
            long now = (Long) callStatic(loader, "lib.Worker", "now");
            // 가상 시간 7 ms + 시계 읽기 비용(1 µs)
            Check.equal(7 * MS + 1000, now, "System.nanoTime in a library class is the virtual clock");
            Check.equal("[NEW, RUNNABLE, BLOCKED, WAITING, TIMED_WAITING, TERMINATED]",
                    callStatic(loader, "lib.Worker", "order"), "new HashMap in a library class keeps insertion order");
            Class<?> worker = Class.forName("lib.Worker", false, loader);
            Check.isTrue(worker.getClassLoader() == loader, "defined by the library loader");
            Check.equal(loader.getURLs()[0].toString(),
                    worker.getProtectionDomain().getCodeSource().getLocation().toString(), "code source is the jar");
            Check.isTrue(worker.getProtectionDomain().getCodeSource().getCodeSigners() == null, "no signers");
            Check.equal("4.5.6", worker.getPackage().getImplementationVersion(), "package from the manifest");
        }
    }

    public static void testTeamSubclassOfALibraryThreadSleepsVirtually() throws Exception {
        Map<String, byte[]> lib = compile(Collections.singletonMap("lib.Worker", WORKER), Collections.emptyList());
        Path libJar = jar(classEntries(lib), false);
        String team = "package team; public class TeamWorker extends lib.Worker {"
                + " public static void nap() throws InterruptedException { sleep(10); } }";
        Map<String, byte[]> teamClasses = compile(Collections.singletonMap("team.TeamWorker", team),
                Collections.singletonList(libJar.toString()));
        try (LibraryClassLoader libraries = loader(libJar)) {
            TeamClassLoader teamLoader = new TeamClassLoader(teamClasses, libraries, libraries.hierarchy);
            TestSim.reset();
            long before = TestSim.nanos();
            callStatic(teamLoader, "team.TeamWorker", "nap");
            // TeamWorker.sleep(J)V → TeamWorker(팀) → lib.Worker(라이브러리 jar, 바이트) → Thread
            Check.equal(10 * MS + 1000, TestSim.nanos() - before, "sleep in a team subclass of a library Thread");
        }
    }

    public static void testMultiReleaseJarUsesTheRunningJdkVersion() throws Exception {
        String base = "package mr; public class Version { public static String which() { return \"base\"; } }";
        String v11 = "package mr; public class Version { public static String which() { return \"11\"; } }";
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("mr/Version.class", compile(Collections.singletonMap("mr.Version", base), Collections.emptyList())
                .get("mr.Version"));
        entries.put("META-INF/versions/11/mr/Version.class",
                compile(Collections.singletonMap("mr.Version", v11), Collections.emptyList()).get("mr.Version"));
        entries.put("mr/data.txt", "hello".getBytes(StandardCharsets.UTF_8));
        Path file = jar(entries, true);
        try (LibraryClassLoader loader = loader(file)) {
            Check.equal("11", callStatic(loader, "mr.Version", "which"), "versioned class for JDK 11+");
            URL resource = loader.getResource("mr/data.txt");
            Check.isTrue(resource != null, "resource from the jar");
            try (InputStream in = loader.getResourceAsStream("mr/data.txt")) {
                Check.equal("hello", new String(in.readAllBytes(), StandardCharsets.UTF_8), "resource content");
            }
            LibraryJars jars = LibraryJars.open(Collections.singletonList(file.toString()));
            try {
                Check.equal(Collections.singletonList("mr/Version"), jars.jars.get(0).classNames(),
                        "class names hide the versioned copies");
            } finally {
                jars.close();
            }
        }
    }

    public static void testSignatureFilesAreIgnored() throws Exception {
        Map<String, byte[]> entries = classEntries(compile(Collections.singletonMap("lib.Worker", WORKER),
                Collections.emptyList()));
        // 맞지 않는 서명 파일(패치가 바이트를 바꾸므로 서명은 어차피 맞지 않는다)
        entries.put("META-INF/SIGNER.SF", "Signature-Version: 1.0\nSHA-256-Digest-Manifest: AAAA\n\n"
                .getBytes(StandardCharsets.UTF_8));
        entries.put("META-INF/SIGNER.RSA", new byte[] {1, 2, 3, 4});
        try (LibraryClassLoader loader = loader(jar(entries, false))) {
            TestSim.reset();
            Check.isTrue((Long) callStatic(loader, "lib.Worker", "now") >= 0, "signed-looking jar loads");
        }
    }

    public static void testParentFirstAndUnpatchableClasses() throws Exception {
        String shadow = "package org.sandbot.runtime; public class Json { }";
        Map<String, byte[]> entries = classEntries(compile(Collections.singletonMap("org.sandbot.runtime.Json", shadow),
                Collections.emptyList()));
        entries.put("lib/Broken.class", new byte[] {(byte) 0xCA, (byte) 0xFE, (byte) 0xBA, (byte) 0xBE, 0, 0, 0, 52});
        try (LibraryClassLoader loader = loader(jar(entries, false))) {
            Check.isTrue(Class.forName("org.sandbot.runtime.Json", false, loader) == Json.class,
                    "the app loader's class wins (parent first)");
            ClassNotFoundException e = Check.throwsType(ClassNotFoundException.class,
                    () -> Class.forName("lib.Broken", false, loader), "a class that cannot be patched is not defined");
            Check.isTrue(e.getMessage().contains("could not be prepared for the simulator"), e.getMessage());
        }
    }

    public static void testHierarchyOfJarsReadsBytesOnly() throws Exception {
        Map<String, byte[]> classes = compile(Collections.singletonMap("lib.Worker", WORKER), Collections.emptyList());
        Path file = jar(classEntries(classes), false);
        LibraryJars jars = LibraryJars.open(Collections.singletonList(file.toString()));
        try {
            ClassHierarchy h = ClassHierarchy.ofJars(jars.files());
            Check.equal("java/lang/Thread", h.lookup("lib/Worker").superName, "super from bytes");
            Check.isTrue(h.lookup("lib/Worker").declares("now", "()J"), "declared methods");
            Check.isTrue(h.lookup("lib/Missing") == null, "unknown class");
        } finally {
            jars.close();
        }
        IOException missing = Check.throwsType(IOException.class,
                () -> LibraryJars.open(Collections.singletonList(file + ".nope")), "missing jar");
        Check.isTrue(missing.getMessage().contains("library jar not found"), missing.getMessage());
    }
}
