package org.sandbot.runtime;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.zip.ZipFile;

/**
 * 실행 클래스패스의 라이브러리 jar(RunRequest.libraryClasspath)를 연 것. LibraryClassLoader(정의), ClassHierarchy.ofJars(패치의
 * 상속 관계), LinkCheck(링크 검사)가 같이 쓴다.
 *
 * <ul>
 *   <li>멀티 릴리스 jar는 실행 중인 JDK 버전으로 연다(META-INF/versions/N의 같은 이름 클래스가 보인다).
 *   <li>서명은 확인하지 않는다(verify false): 패치가 클래스 바이트를 바꾸므로 서명은 어차피 맞지 않고, 정의할 때 서명자도 넣지 않는다.
 *   <li>순서는 요청 순서다(앞의 jar가 같은 이름 클래스를 가린다, 실제 클래스패스와 같음).
 * </ul>
 */
final class LibraryJars implements Closeable {
    /** jar 하나 */
    static final class Jar {
        /** 요청의 경로 그대로(linkReport의 jar) */
        final String path;
        final JarFile file;
        final URL url;

        Jar(String path, JarFile file, URL url) {
            this.path = path;
            this.file = file;
            this.url = url;
        }

        /** 클래스 파일 바이트(없으면 null) */
        byte[] classBytes(String internalName) throws IOException {
            JarEntry entry = file.getJarEntry(internalName + ".class");
            if (entry == null || entry.isDirectory()) return null;
            try (InputStream in = file.getInputStream(entry)) {
                return in.readAllBytes();
            }
        }

        /**
         * 이 jar의 클래스 내부 이름(이름순, 멀티 릴리스면 지금 JDK에서 보이는 것). META-INF 아래(버전별 원본 자리 포함)와
         * module-info·package-info는 뺀다.
         */
        List<String> classNames() {
            List<String> names = new ArrayList<>();
            file.versionedStream().forEach(e -> {
                String name = e.getName();
                if (e.isDirectory() || !name.endsWith(".class") || name.startsWith("META-INF/")) return;
                String internal = name.substring(0, name.length() - ".class".length());
                if (internal.endsWith("module-info") || internal.endsWith("package-info")) return;
                names.add(internal);
            });
            Collections.sort(names);
            return names;
        }
    }

    final List<Jar> jars;

    private LibraryJars(List<Jar> jars) {
        this.jars = Collections.unmodifiableList(jars);
    }

    /** 경로들을 연다. 하나라도 열지 못하면 연 것을 닫고 IOException(영어 메시지, 경로 포함). */
    static LibraryJars open(List<String> paths) throws IOException {
        List<Jar> jars = new ArrayList<>();
        try {
            for (String path : paths) {
                File file = new File(path);
                if (!file.isFile()) throw new IOException("library jar not found: " + path);
                JarFile jar;
                try {
                    jar = new JarFile(file, false, ZipFile.OPEN_READ, Runtime.version());
                } catch (IOException e) {
                    throw new IOException("cannot open library jar " + path + ": " + e.getMessage(), e);
                }
                URL url;
                try {
                    url = file.toURI().toURL();
                } catch (MalformedURLException e) {
                    jar.close();
                    throw new IOException("bad library jar path " + path, e);
                }
                jars.add(new Jar(path, jar, url));
            }
        } catch (IOException e) {
            for (Jar j : jars) j.file.close();
            throw e;
        }
        return new LibraryJars(jars);
    }

    List<JarFile> files() {
        List<JarFile> out = new ArrayList<>();
        for (Jar j : jars) out.add(j.file);
        return out;
    }

    URL[] urls() {
        URL[] out = new URL[jars.size()];
        for (int i = 0; i < out.length; i++) out[i] = jars.get(i).url;
        return out;
    }

    @Override
    public void close() throws IOException {
        for (Jar j : jars) j.file.close();
    }
}
