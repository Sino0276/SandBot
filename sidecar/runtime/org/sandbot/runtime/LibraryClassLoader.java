package org.sandbot.runtime;

import org.sandbot.runtime.patch.ClassHierarchy;
import org.sandbot.runtime.patch.ClassPatcher;
import org.sandbot.runtime.patch.PatchException;

import java.io.IOException;
import java.net.URLClassLoader;
import java.security.CodeSigner;
import java.security.CodeSource;
import java.util.jar.Manifest;

/**
 * 팀 Gradle의 실행 클래스패스 라이브러리(RunRequest.libraryClasspath)를 정의하는 클래스 로더(부모 = 앱 로더: 가짜 SDK·sim·런타임,
 * TeamClassLoader의 부모). 정의하기 전에 ClassPatcher로 시간 API를 가상 시계로, 해시 순서 컬렉션을 삽입 순서로 바꾼다(팀 코드와
 * 같은 패치). 그래서 Pedro·FTCLib의 System.nanoTime·Thread.sleep도 가상 시계다.
 *
 * <ul>
 *   <li>부모를 먼저 찾는다: 라이브러리가 SDK·JDK와 같은 이름의 클래스를 실어도(Gson 등) 가짜 SDK 것이 쓰인다(실제 앱에서도 SDK가
 *       같은 클래스를 갖는다).
 *   <li>클래스 바이트는 LibraryJars(멀티 릴리스는 실행 JDK 기준, 서명 확인 없음)에서 읽고, 코드 소스는 그 jar(서명자 없음)다.
 *   <li>패치하지 못한 클래스는 정의하지 않는다(진짜 시계를 쓰게 되므로): 쓰는 쪽에는 NoClassDefFoundError로 보인다.
 *   <li>상속 관계는 바이트로 읽는다(앱 로더 → 라이브러리 jar 순, ClassHierarchy.ofJars): 패치 때문에 다른 라이브러리 클래스가
 *       정의되는 부작용이 없다.
 *   <li>리소스(getResource)는 URLClassLoader가 같은 jar에서 찾는다.
 * </ul>
 */
final class LibraryClassLoader extends URLClassLoader {
    static {
        registerAsParallelCapable();
    }

    private final LibraryJars jars;
    private final ClassPatcher patcher;
    /** 이 로더가 정의하는 클래스의 상속 관계(팀 로더도 이어서 쓴다) */
    final ClassHierarchy hierarchy;

    LibraryClassLoader(LibraryJars jars, ClassLoader parent) {
        super("SandBotLibraries", jars.urls(), parent);
        this.jars = jars;
        this.hierarchy = ClassHierarchy.chain(ClassHierarchy.ofClassLoader(parent), ClassHierarchy.ofJars(jars.files()));
        this.patcher = new ClassPatcher(hierarchy);
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        String internal = name.replace('.', '/');
        for (LibraryJars.Jar jar : jars.jars) {
            byte[] bytes;
            try {
                bytes = jar.classBytes(internal);
            } catch (IOException e) {
                throw new ClassNotFoundException(name + " could not be read from " + jar.path + ": " + e.getMessage());
            }
            if (bytes == null) continue;
            byte[] patched;
            try {
                patched = patcher.apply(bytes).bytes;
            } catch (PatchException e) {
                throw new ClassNotFoundException(name + " (" + jar.path + ") could not be prepared for the simulator: "
                        + e.getMessage());
            }
            definePackageOf(name, jar);
            try {
                return defineClass(name, patched, 0, patched.length, new CodeSource(jar.url, (CodeSigner[]) null));
            } catch (SecurityException e) {
                // java.* 같은 금지된 패키지
                throw new ClassNotFoundException(name + " (" + jar.path + ") cannot be defined: " + e.getMessage());
            }
        }
        throw new ClassNotFoundException(name);
    }

    /** URLClassLoader처럼 jar의 매니페스트로 패키지를 정의한다(Package.getImplementationVersion 등) */
    private void definePackageOf(String className, LibraryJars.Jar jar) {
        int dot = className.lastIndexOf('.');
        if (dot < 0) return;
        String pkg = className.substring(0, dot);
        if (getDefinedPackage(pkg) != null) return;
        Manifest manifest;
        try {
            manifest = jar.file.getManifest();
        } catch (IOException e) {
            manifest = null;
        }
        try {
            if (manifest != null) definePackage(pkg, manifest, jar.url);
            else definePackage(pkg, null, null, null, null, null, null, null);
        } catch (IllegalArgumentException e) {
            // 다른 스레드가 먼저 정의했다
        }
    }

    @Override
    public void close() throws IOException {
        try {
            super.close();
        } finally {
            jars.close();
        }
    }
}
