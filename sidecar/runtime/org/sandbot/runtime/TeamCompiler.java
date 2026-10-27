package org.sandbot.runtime;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.StringWriter;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
 * <p>옵션: --release 8 -g -proc:none -encoding UTF-8 -Xlint:-options -implicit:class -Xmaxerrs 100 -Xmaxwarns 100,
 * -classpath = sdkClasspath(가짜 FTC SDK). 진단은 Locale.ENGLISH.
 */
final class TeamCompiler {
    static final int MAX_ERRORS = 100;

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

    static Result compile(List<String> sourceRoots, String opModeSource, List<String> sdkClasspath)
            throws NoCompilerException, IOException {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new NoCompilerException();

        List<Map<String, Object>> diagnostics = new ArrayList<>();
        int[] errors = {0};
        DiagnosticListener<JavaFileObject> listener = d -> {
            if (d.getKind() == Diagnostic.Kind.ERROR) {
                if (errors[0] >= MAX_ERRORS) return;
                errors[0]++;
            }
            diagnostics.add(diagnostic(d));
        };

        Map<String, byte[]> classes = new LinkedHashMap<>();
        Map<String, String> sources = new LinkedHashMap<>();
        StandardJavaFileManager standard = compiler.getStandardFileManager(listener, Locale.ENGLISH, StandardCharsets.UTF_8);
        try (MemoryFileManager files = new MemoryFileManager(standard, classes, sources)) {
            List<String> options = new ArrayList<>(Arrays.asList("--release", "8", "-g", "-proc:none", "-encoding",
                    "UTF-8", "-Xlint:-options", "-implicit:class", "-Xmaxerrs", String.valueOf(MAX_ERRORS),
                    "-Xmaxwarns", "100"));
            options.add("-sourcepath");
            options.add(String.join(File.pathSeparator, sourceRoots));
            options.add("-classpath");
            options.add(String.join(File.pathSeparator, sdkClasspath));
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

    private static Map<String, Object> diagnostic(Diagnostic<? extends JavaFileObject> d) {
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
        long column = d.getColumnNumber();
        return Json.obj("kind", kind, "file", file, "line", line < 0 ? 0L : line, "column", column < 0 ? 0L : column,
                "message", d.getMessage(Locale.ENGLISH), "code", d.getCode() == null ? "" : d.getCode());
    }

    static String absolutePath(URI uri) {
        if (uri == null || !"file".equals(uri.getScheme())) return null;
        try {
            return Paths.get(uri).toAbsolutePath().normalize().toString();
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** 클래스 출력을 메모리에 받는 파일 관리자. 소스(sibling)로 클래스 → 소스 표를 만든다. */
    private static final class MemoryFileManager extends ForwardingJavaFileManager<StandardJavaFileManager> {
        private final Map<String, byte[]> classes;
        private final Map<String, String> sources;

        MemoryFileManager(StandardJavaFileManager standard, Map<String, byte[]> classes, Map<String, String> sources) {
            super(standard);
            this.classes = classes;
            this.sources = sources;
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
