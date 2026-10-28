package org.sandbot.tools;

import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 시험용 Android 플랫폼 jar 대역(사이드카 시험의 bootClasspath). CI·컨테이너에는 Android SDK가 없어서, 이 JVM의 jrt:/ 모듈(기본
 * java.base)에서 java/**·javax/** 클래스 파일을 골라 jar 하나로 쓴다. 실제 android.jar처럼 java.base 밖(java.net.http,
 * java.desktop 등)은 없다. 이름순·고정 시각이라 같은 JDK면 같은 바이트다. --exclude 접두어로 일부를 뺄 수 있다(예: 람다 바탕
 * 클래스를 빼 TeamCompiler가 채우는지 시험).
 *
 * <p>사용법: java PlatformJar.java --out &lt;jar&gt; [--module &lt;이름&gt;]... [--exclude &lt;접두어&gt;]... (소스 파일 하나로
 * 바로 실행할 수 있다: java sidecar/tools/org/sandbot/tools/PlatformJar.java …)
 */
public final class PlatformJar {
    private PlatformJar() {}

    private static final LocalDateTime FIXED_TIME = LocalDateTime.of(1980, 1, 1, 0, 0);

    public static void main(String[] args) throws IOException {
        Path out = null;
        List<String> modules = new ArrayList<>();
        List<String> excludes = new ArrayList<>();
        for (int i = 0; i < args.length; i++) {
            String value = i + 1 < args.length ? args[i + 1] : null;
            switch (args[i]) {
                case "--out":
                    out = Paths.get(require(args[i], value));
                    i++;
                    break;
                case "--module":
                    modules.add(require(args[i], value));
                    i++;
                    break;
                case "--exclude":
                    excludes.add(require(args[i], value));
                    i++;
                    break;
                default:
                    throw new IllegalArgumentException("unknown option " + args[i]);
            }
        }
        if (out == null) throw new IllegalArgumentException("--out is required");
        if (modules.isEmpty()) modules.add("java.base");

        FileSystem jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        TreeMap<String, Path> entries = new TreeMap<>();
        for (String module : modules) {
            Path root = jrt.getPath("/modules", module);
            if (!Files.isDirectory(root)) throw new IllegalArgumentException("no such module " + module);
            try (Stream<Path> walk = Files.walk(root)) {
                walk.filter(Files::isRegularFile).forEach(file -> {
                    String name = root.relativize(file).toString().replace('\\', '/');
                    if (!name.endsWith(".class") || name.equals("module-info.class")) return;
                    if (!name.startsWith("java/") && !name.startsWith("javax/")) return;
                    for (String prefix : excludes) {
                        if (name.startsWith(prefix)) return;
                    }
                    entries.put(name, file);
                });
            }
        }

        Path parent = out.toAbsolutePath().getParent();
        Files.createDirectories(parent);
        Path temp = Files.createTempFile(parent, out.getFileName().toString(), ".tmp");
        try {
            try (OutputStream stream = Files.newOutputStream(temp); ZipOutputStream zip = new ZipOutputStream(stream)) {
                for (java.util.Map.Entry<String, Path> entry : entries.entrySet()) {
                    ZipEntry zipEntry = new ZipEntry(entry.getKey());
                    zipEntry.setTimeLocal(FIXED_TIME);
                    zip.putNextEntry(zipEntry);
                    zip.write(Files.readAllBytes(entry.getValue()));
                    zip.closeEntry();
                }
            }
            Files.move(temp, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temp);
        }
        System.out.println("test platform jar: " + out + " (" + entries.size() + " classes from " + modules + ")");
    }

    private static String require(String option, String value) {
        if (value == null) throw new IllegalArgumentException(option + " needs a value");
        return value;
    }
}
