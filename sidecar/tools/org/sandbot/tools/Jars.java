package org.sandbot.tools;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.TreeMap;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** jar 읽기·쓰기. 쓰는 jar는 결정적이다(이름 순서, 고정 시각): 같은 입력이면 같은 바이트. */
final class Jars {
    private Jars() {}

    /** 2000-01-01 00:00(로컬). ZIP 시각은 DOS 형식이라 1980 이전은 쓸 수 없다. */
    private static final long FIXED_TIME = 946684800000L;

    static byte[] readAll(ZipFile zip, ZipEntry entry) throws IOException {
        try (InputStream in = zip.getInputStream(entry)) {
            return readAll(in);
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[65536];
        int n;
        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        return out.toByteArray();
    }

    /** 폴더들의 파일을 모은다(경로 → 파일). 같은 경로가 두 폴더에 있으면 오류. */
    static Map<String, Path> collect(Path... roots) throws IOException {
        Map<String, Path> files = new TreeMap<>();
        for (Path root : roots) {
            if (!Files.isDirectory(root)) continue;
            try (Stream<Path> walk = Files.walk(root)) {
                for (Path p : (Iterable<Path>) walk.filter(Files::isRegularFile).sorted()::iterator) {
                    String rel = root.relativize(p).toString().replace('\\', '/');
                    Path previous = files.put(rel, p);
                    if (previous != null)
                        throw new IllegalStateException("duplicate jar entry " + rel + ": " + previous + " and " + p);
                }
            }
        }
        return files;
    }

    /**
     * 파일들로 jar를 쓴다. 옆에 임시 파일을 쓰고 바꾼다(쓰다 실패해도 이전 jar는 그대로).
     *
     * @param mainClass null이 아니면 Main-Class
     */
    static void write(Path jar, Map<String, Path> files, Map<String, byte[]> extra, String mainClass) throws IOException {
        Map<String, byte[]> all = new TreeMap<>();
        for (Map.Entry<String, Path> e : files.entrySet()) all.put(e.getKey(), Files.readAllBytes(e.getValue()));
        for (Map.Entry<String, byte[]> e : extra.entrySet()) {
            if (all.put(e.getKey(), e.getValue()) != null)
                throw new IllegalStateException("duplicate jar entry " + e.getKey());
        }
        Manifest manifest = new Manifest();
        manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        manifest.getMainAttributes().put(new Attributes.Name("Created-By"), "SandBot sidecar build");
        if (mainClass != null) manifest.getMainAttributes().put(Attributes.Name.MAIN_CLASS, mainClass);
        Files.createDirectories(jar.toAbsolutePath().getParent());
        Path temp = jar.resolveSibling("." + jar.getFileName() + ".tmp");
        try (OutputStream file = Files.newOutputStream(temp); JarOutputStream out = new JarOutputStream(file)) {
            put(out, "META-INF/", null);
            ByteArrayOutputStream manifestBytes = new ByteArrayOutputStream();
            manifest.write(manifestBytes);
            put(out, "META-INF/MANIFEST.MF", manifestBytes.toByteArray());
            String lastDir = "";
            for (Map.Entry<String, byte[]> e : all.entrySet()) {
                String name = e.getKey();
                if (name.equals("META-INF/MANIFEST.MF")) continue;
                // 폴더 항목(정렬 순서에서 처음 나올 때)
                int slash = name.lastIndexOf('/');
                String dir = slash < 0 ? "" : name.substring(0, slash + 1);
                if (!dir.isEmpty() && !dir.equals(lastDir) && !dir.equals("META-INF/")) {
                    // 상위 폴더도 차례로
                    String[] parts = dir.split("/");
                    StringBuilder path = new StringBuilder();
                    for (String part : parts) {
                        path.append(part).append('/');
                        String p = path.toString();
                        if (!lastDir.startsWith(p)) put(out, p, null);
                    }
                    lastDir = dir;
                }
                put(out, name, e.getValue());
            }
        }
        Files.move(temp, jar, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private static void put(JarOutputStream out, String name, byte[] bytes) throws IOException {
        JarEntry entry = new JarEntry(name);
        entry.setTime(FIXED_TIME);
        out.putNextEntry(entry);
        if (bytes != null) out.write(bytes);
        out.closeEntry();
    }
}
