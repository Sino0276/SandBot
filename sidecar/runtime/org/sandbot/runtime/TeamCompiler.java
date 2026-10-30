package org.sandbot.runtime;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.StringWriter;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticListener;
import javax.tools.FileObject;
import javax.tools.ForwardingJavaFileManager;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;

/**
 * 팀 코드를 사이드카 안에서 컴파일한다(javax.tools, 결과는 메모리에만). 시작 파일은 OpMode 소스 하나이고, 필요한 다른 파일은
 * -sourcepath(sourceRoots)로 javac가 찾는다(-implicit:class라 그것들도 클래스가 된다).
 *
 * <p>옵션: -source 8 -target 8 -bootclasspath bootClasspath(팀 프로젝트 compileSdk의 Android 플랫폼 API — Android Studio와
 * 같은 문법·API) -g -proc:none -encoding UTF-8 -Xlint:-options -implicit:class -Xmaxerrs 100 -Xmaxwarns 100,
 * -classpath = compileClasspath(가짜 FTC SDK + 라이브러리). bootClasspath가 비면 -source·-target·-bootclasspath 대신
 * --release 8(호스트 JDK의 Java 8 API, 사이드카 시험만). 진단은 Locale.ENGLISH.
 *
 * <p>Android 플랫폼 jar(android.jar)에는 javac가 람다·메서드 참조를 컴파일할 때 찾는 java.lang.invoke.LambdaMetafactory 등이
 * 없다(Android는 D8이 람다를 바꾸므로). Android Gradle 플러그인은 build-tools의 core-lambda-stubs.jar를 부트 클래스패스
 * 뒤에 붙인다. 여기서는 같은 여덟 클래스(LAMBDA_SUPPORT) 중 부트 클래스패스에 없는 것만 이 JVM(jrt:/java.base)의 것으로
 * 메모리에서 채운다(파일을 쓰지 않음). 플랫폼에 있는 것은 플랫폼 것이 이긴다(core-lambda-stubs.jar가 뒤에 붙는 것과 같다).
 * 부트 클래스패스의 파일이 없으면 javac는 조용히 건너뛰고 "package java.lang does not exist"로 실패하므로, 먼저 확인해
 * sandbot.platformMissing 진단 하나로 알린다.
 */
final class TeamCompiler {
    static final int MAX_ERRORS = 100;

    /** core-lambda-stubs.jar(build-tools 34)에 든 클래스들. 플랫폼에 없을 때만 호스트 JDK의 것으로 채운다. */
    static final List<String> LAMBDA_SUPPORT = Collections.unmodifiableList(Arrays.asList(
            "java.lang.invoke.CallSite",
            "java.lang.invoke.LambdaConversionException",
            "java.lang.invoke.LambdaMetafactory",
            "java.lang.invoke.MethodHandle",
            "java.lang.invoke.MethodHandles",
            "java.lang.invoke.MethodHandles$Lookup",
            "java.lang.invoke.MethodType",
            "java.lang.invoke.SerializedLambda"));

    static final class Result {
        final boolean ok;
        final List<Map<String, Object>> diagnostics;
        /** 바이너리 이름(Outer$Inner) → 클래스 파일 */
        final Map<String, byte[]> classes;
        /** 바이너리 이름 → 그 클래스를 만든 소스의 절대 경로 */
        final Map<String, String> sources;

        Result(boolean ok, List<Map<String, Object>> diagnostics, Map<String, byte[]> classes,
                Map<String, String> sources) {
            this.ok = ok;
            this.diagnostics = diagnostics;
            this.classes = classes;
            this.sources = sources;
        }
    }

    /** JDK에 컴파일러가 없다(JRE) */
    static final class NoCompilerException extends Exception {
        NoCompilerException() {
            super("the Java runtime running the sidecar has no Java compiler (a JDK is required, not a JRE)");
        }
    }

    static Result compile(List<String> sourceRoots, String opModeSource, List<String> bootClasspath,
            List<String> compileClasspath) throws NoCompilerException, IOException {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new NoCompilerException();

        List<Map<String, Object>> diagnostics = new ArrayList<>();
        int[] errors = {0};
        Map<JavaFileObject, CharSequence> contents = new HashMap<>();
        DiagnosticListener<JavaFileObject> listener = d -> {
            if (d.getKind() == Diagnostic.Kind.ERROR) {
                if (errors[0] >= MAX_ERRORS) return;
                errors[0]++;
            }
            diagnostics.add(diagnostic(d, contents));
        };

        Map<String, byte[]> classes = new LinkedHashMap<>();
        Map<String, String> sources = new LinkedHashMap<>();
        for (String entry : bootClasspath) {
            if (!readable(entry)) {
                diagnostics.add(Json.obj("kind", "error", "file", null, "line", 0L, "column", 0L, "message",
                        "the Android platform API jar does not exist: " + entry, "code", "sandbot.platformMissing"));
                return new Result(false, diagnostics, Collections.emptyMap(), sources);
            }
        }
        List<PlatformClass> lambdaSupport = bootClasspath.isEmpty() ? Collections.emptyList() : lambdaSupport();
        StandardJavaFileManager standard = compiler.getStandardFileManager(listener, Locale.ENGLISH, StandardCharsets.UTF_8);
        try (MemoryFileManager files = new MemoryFileManager(standard, classes, sources, lambdaSupport)) {
            List<String> options = new ArrayList<>();
            if (bootClasspath.isEmpty()) {
                options.addAll(Arrays.asList("--release", "8"));
            } else {
                options.addAll(Arrays.asList("-source", "8", "-target", "8", "-bootclasspath",
                        String.join(File.pathSeparator, bootClasspath)));
            }
            options.addAll(Arrays.asList("-g", "-proc:none", "-encoding", "UTF-8", "-Xlint:-options",
                    "-implicit:class", "-Xmaxerrs", String.valueOf(MAX_ERRORS), "-Xmaxwarns", "100"));
            options.add("-sourcepath");
            options.add(String.join(File.pathSeparator, sourceRoots));
            options.add("-classpath");
            options.add(String.join(File.pathSeparator, compileClasspath));
            Iterable<? extends JavaFileObject> units = standard.getJavaFileObjects(new File(opModeSource));
            StringWriter javacOut = new StringWriter();
            JavaCompiler.CompilationTask task = compiler.getTask(javacOut, files, listener, options, null, units);
            task.setLocale(Locale.ENGLISH);
            boolean ok;
            try {
                ok = task.call();
            } catch (RuntimeException e) {
                // javac 자체 오류(잘못된 옵션·읽을 수 없는 파일 등)
                diagnostics.add(Json.obj("kind", "error", "file", null, "line", 0L, "column", 0L, "message",
                        String.valueOf(e.getMessage()), "code", "sandbot.javacFailure"));
                ok = false;
            }
            String extra = javacOut.toString().trim();
            if (!ok && errors[0] == 0) {
                // 진단 없이 실패(옵션 오류 등은 javac가 Writer로만 쓴다)
                diagnostics.add(Json.obj("kind", "error", "file", null, "line", 0L, "column", 0L, "message",
                        extra.isEmpty() ? "compilation failed" : extra, "code", "sandbot.javacFailure"));
            }
            return new Result(ok && errors[0] == 0, diagnostics, ok ? classes : Collections.emptyMap(), sources);
        }
    }

    private static Map<String, Object> diagnostic(Diagnostic<? extends JavaFileObject> d,
            Map<JavaFileObject, CharSequence> contents) {
        String kind;
        switch (d.getKind()) {
            case ERROR:
                kind = "error";
                break;
            case WARNING:
            case MANDATORY_WARNING:
                kind = "warning";
                break;
            default:
                kind = "note";
        }
        String file = null;
        JavaFileObject source = d.getSource();
        if (source != null) file = absolutePath(source.toUri());
        long line = d.getLineNumber();
        long column = characterColumn(source, d.getPosition(), contents);
        if (column <= 0) column = d.getColumnNumber();
        return Json.obj("kind", kind, "file", file, "line", line < 0 ? 0L : line, "column", column < 0 ? 0L : column,
                "message", d.getMessage(Locale.ENGLISH), "code", d.getCode() == null ? "" : d.getCode());
    }

    /**
     * 진단 위치의 열(1부터, 글자 단위). javac의 getColumnNumber는 탭을 8칸 탭 정지로 펼쳐 세므로(탭으로 들여 쓴 줄이면 편집기의
     * 열과 다르다) 소스의 글자 위치에서 줄 시작까지 센다. 알 수 없으면 0.
     */
    static long characterColumn(JavaFileObject source, long position, Map<JavaFileObject, CharSequence> contents) {
        if (source == null || position < 0) return 0;
        CharSequence text = contents.computeIfAbsent(source, s -> {
            try {
                return s.getCharContent(true);
            } catch (IOException | RuntimeException e) {
                return "";
            }
        });
        if (position > text.length()) return 0;
        int start = (int) position;
        while (start > 0 && text.charAt(start - 1) != '\n' && text.charAt(start - 1) != '\r') start--;
        return position - start + 1;
    }

    static String absolutePath(URI uri) {
        if (uri == null || !"file".equals(uri.getScheme())) return null;
        try {
            return Paths.get(uri).toAbsolutePath().normalize().toString();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean readable(String entry) {
        try {
            return !entry.isEmpty() && Files.isReadable(Paths.get(entry));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** 이 JVM의 java.base에서 읽은 LAMBDA_SUPPORT 클래스(읽지 못한 것은 뺀다. 그러면 javac가 그 클래스가 없다고 알린다) */
    static List<PlatformClass> lambdaSupport() {
        List<PlatformClass> found = new ArrayList<>();
        FileSystem jrt;
        try {
            jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        } catch (RuntimeException e) {
            return found;
        }
        for (String name : LAMBDA_SUPPORT) {
            Path file = jrt.getPath("/modules/java.base/" + name.replace('.', '/') + ".class");
            try {
                found.add(new PlatformClass(name, Files.readAllBytes(file)));
            } catch (IOException | RuntimeException e) {
                // 없는 클래스는 채우지 않는다
            }
        }
        return found;
    }

    /** 부트 클래스패스에 덧붙이는 메모리 안 클래스 파일 */
    static final class PlatformClass extends SimpleJavaFileObject {
        final String binaryName;
        final String packageName;
        private final byte[] bytes;

        PlatformClass(String binaryName, byte[] bytes) {
            super(URI.create("sandbot-platform:///" + binaryName.replace('.', '/') + ".class"), JavaFileObject.Kind.CLASS);
            this.binaryName = binaryName;
            this.packageName = binaryName.substring(0, binaryName.lastIndexOf('.'));
            this.bytes = bytes;
        }

        @Override
        public InputStream openInputStream() {
            return new ByteArrayInputStream(bytes);
        }
    }

    /**
     * 클래스 출력을 메모리에 받는 파일 관리자. 소스(sibling)로 클래스 → 소스 표를 만든다. 부트 클래스패스 목록에 platformExtras 중
     * 그 패키지에 없는 것을 덧붙인다.
     */
    private static final class MemoryFileManager extends ForwardingJavaFileManager<StandardJavaFileManager> {
        private final Map<String, byte[]> classes;
        private final Map<String, String> sources;
        private final List<PlatformClass> platformExtras;

        MemoryFileManager(StandardJavaFileManager standard, Map<String, byte[]> classes, Map<String, String> sources,
                List<PlatformClass> platformExtras) {
            super(standard);
            this.classes = classes;
            this.sources = sources;
            this.platformExtras = platformExtras;
        }

        @Override
        public Iterable<JavaFileObject> list(Location location, String packageName, Set<JavaFileObject.Kind> kinds,
                boolean recurse) throws IOException {
            Iterable<JavaFileObject> listed = super.list(location, packageName, kinds, recurse);
            if (platformExtras.isEmpty() || location != StandardLocation.PLATFORM_CLASS_PATH
                    || !kinds.contains(JavaFileObject.Kind.CLASS))
                return listed;
            List<PlatformClass> wanted = new ArrayList<>();
            for (PlatformClass extra : platformExtras) {
                if (extra.packageName.equals(packageName)
                        || (recurse && extra.packageName.startsWith(packageName + ".")))
                    wanted.add(extra);
            }
            if (wanted.isEmpty()) return listed;
            List<JavaFileObject> all = new ArrayList<>();
            Set<String> present = new HashSet<>();
            for (JavaFileObject file : listed) {
                all.add(file);
                present.add(inferBinaryName(location, file));
            }
            for (PlatformClass extra : wanted) {
                if (!present.contains(extra.binaryName)) all.add(extra);
            }
            return all;
        }

        @Override
        public String inferBinaryName(Location location, JavaFileObject file) {
            if (file instanceof PlatformClass) return ((PlatformClass) file).binaryName;
            return super.inferBinaryName(location, file);
        }

        @Override
        public JavaFileObject getJavaFileForOutput(Location location, String className, JavaFileObject.Kind kind,
                FileObject sibling) throws IOException {
            if (location != StandardLocation.CLASS_OUTPUT || kind != JavaFileObject.Kind.CLASS)
                return super.getJavaFileForOutput(location, className, kind, sibling);
            if (sibling != null) {
                String path = absolutePath(sibling.toUri());
                if (path != null) sources.put(className, path);
            }
            return new SimpleJavaFileObject(URI.create("mem:///" + className.replace('.', '/') + ".class"), kind) {
                @Override
                public OutputStream openOutputStream() {
                    return new ByteArrayOutputStream() {
                        @Override
                        public void close() throws IOException {
                            super.close();
                            classes.put(className, toByteArray());
                        }
                    };
                }
            };
        }
    }
}
