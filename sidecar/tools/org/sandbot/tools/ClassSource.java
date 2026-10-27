package org.sandbot.tools;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.DirectoryStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** 클래스 파일 묶음(jar·폴더·JDK). 이름은 내부 이름(com/x/Foo$Bar). 읽은 것은 캐시한다. */
abstract class ClassSource {
    private final Map<String, ClassFile> parsed = new HashMap<>();

    /** 이 묶음의 모든 클래스 이름(정렬). JDK는 모른다(빈 목록). */
    abstract List<String> names();

    /** 클래스 파일 내용, 없으면 null */
    abstract byte[] bytes(String internalName);

    final ClassFile get(String internalName) {
        if (parsed.containsKey(internalName)) return parsed.get(internalName);
        byte[] bytes = bytes(internalName);
        ClassFile file = null;
        if (bytes != null) {
            try {
                file = ClassFile.parse(bytes);
            } catch (IOException | RuntimeException e) {
                throw new IllegalStateException("cannot read class " + internalName + ": " + e, e);
            }
        }
        parsed.put(internalName, file);
        return file;
    }

    final boolean has(String internalName) {
        return get(internalName) != null;
    }

    /** 폴더의 클래스 파일 트리 */
    static ClassSource directory(Path root) {
        Map<String, Path> files = new TreeMap<>();
        if (Files.isDirectory(root)) {
            try (Stream<Path> walk = Files.walk(root)) {
                walk.filter(p -> p.toString().endsWith(".class") && Files.isRegularFile(p)).forEach(p -> {
                    String rel = root.relativize(p).toString().replace('\\', '/');
                    files.put(rel.substring(0, rel.length() - ".class".length()), p);
                });
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        return new ClassSource() {
            @Override
            List<String> names() {
                return new ArrayList<>(files.keySet());
            }

            @Override
            byte[] bytes(String internalName) {
                Path path = files.get(internalName);
                if (path == null) return null;
                try {
                    return Files.readAllBytes(path);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            }
        };
    }

    /** jar 하나(META-INF·module-info는 뺀다) */
    static ClassSource jar(Path path) {
        Map<String, byte[]> entries = new TreeMap<>();
        try (ZipFile zip = new ZipFile(path.toFile())) {
            Enumeration<? extends ZipEntry> all = zip.entries();
            while (all.hasMoreElements()) {
                ZipEntry entry = all.nextElement();
                String name = entry.getName();
                if (entry.isDirectory() || !name.endsWith(".class") || name.startsWith("META-INF/")) continue;
                if (name.endsWith("module-info.class") || name.endsWith("package-info.class")) continue;
                entries.put(name.substring(0, name.length() - ".class".length()), Jars.readAll(zip, entry));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + path, e);
        }
        return new ClassSource() {
            @Override
            List<String> names() {
                return new ArrayList<>(entries.keySet());
            }

            @Override
            byte[] bytes(String internalName) {
                return entries.get(internalName);
            }
        };
    }

    /**
     * 지금 JDK의 표준 모듈(java.*) 클래스. 사이드카가 도는 JDK(17 이상)에 있는 API만 들여온 클래스가 쓸 수 있다.
     * jdk.*·sun.* 같은 비표준 모듈은 넣지 않는다.
     */
    static ClassSource jdk() {
        FileSystem jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        Map<String, List<String>> packages = new LinkedHashMap<>();
        try (DirectoryStream<Path> dirs = Files.newDirectoryStream(jrt.getPath("/packages"))) {
            for (Path dir : dirs) {
                List<String> modules = new ArrayList<>();
                try (DirectoryStream<Path> links = Files.newDirectoryStream(dir)) {
                    for (Path link : links) {
                        String module = link.getFileName().toString();
                        if (module.startsWith("java.")) modules.add(module);
                    }
                }
                if (!modules.isEmpty()) packages.put(dir.getFileName().toString().replace('.', '/'), modules);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return new ClassSource() {
            @Override
            List<String> names() {
                return Collections.emptyList();
            }

            @Override
            byte[] bytes(String internalName) {
                List<String> modules = packages.get(ClassFile.packageOf(internalName));
                if (modules == null) return null;
                for (String module : modules) {
                    Path path = jrt.getPath("/modules", module, internalName + ".class");
                    if (Files.exists(path)) {
                        try {
                            return Files.readAllBytes(path);
                        } catch (IOException e) {
                            throw new UncheckedIOException(e);
                        }
                    }
                }
                return null;
            }
        };
    }

    /** 여러 묶음을 차례로(앞이 이김) */
    static ClassSource chain(List<ClassSource> sources) {
        return new ClassSource() {
            @Override
            List<String> names() {
                List<String> all = new ArrayList<>();
                for (ClassSource source : sources) all.addAll(source.names());
                return all;
            }

            @Override
            byte[] bytes(String internalName) {
                for (ClassSource source : sources) {
                    byte[] b = source.bytes(internalName);
                    if (b != null) return b;
                }
                return null;
            }
        };
    }
}
