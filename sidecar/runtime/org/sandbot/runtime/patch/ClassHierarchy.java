package org.sandbot.runtime.patch;

import java.io.IOException;
import java.io.InputStream;
import java.lang.invoke.MethodType;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** 내부 이름으로 클래스 요약을 찾는다. 모르면 null(패처는 바꾸지 않는 쪽으로 판단한다). */
public interface ClassHierarchy {
    ClassInfo lookup(String internalName);

    /**
     * 클래스 로더로 찾는다(초기화하지 않음). JDK 클래스와, 팀 코드가 상속한 SDK 클래스용.
     * 결과는 이 객체 안에 기억한다.
     */
    static ClassHierarchy ofClassLoader(ClassLoader loader) {
        Map<String, ClassInfo> cache = new HashMap<>();
        Set<String> missing = new HashSet<>();
        return internalName -> {
            synchronized (cache) {
                ClassInfo info = cache.get(internalName);
                if (info != null || missing.contains(internalName)) return info;
                info = reflect(loader, internalName);
                if (info == null) missing.add(internalName);
                else cache.put(internalName, info);
                return info;
            }
        };
    }

    /** 먼저 first에서, 없으면 second에서 찾는다 */
    static ClassHierarchy chain(ClassHierarchy first, ClassHierarchy second) {
        return internalName -> {
            ClassInfo info = first.lookup(internalName);
            return info != null ? info : second.lookup(internalName);
        };
    }

    /** 클래스 파일 바이트 표(내부 이름 → 바이트)에서 찾는다(파싱 결과는 기억한다) */
    static ClassHierarchy ofClassFiles(Map<String, byte[]> classFiles) {
        Map<String, ClassInfo> cache = new HashMap<>();
        return internalName -> {
            synchronized (cache) {
                ClassInfo info = cache.get(internalName);
                if (info != null) return info;
                byte[] bytes = classFiles.get(internalName);
                if (bytes == null) return null;
                try {
                    info = ClassFile.readInfo(bytes);
                } catch (PatchException e) {
                    return null;
                }
                cache.put(internalName, info);
                return info;
            }
        };
    }

    /**
     * jar들에서 클래스 파일 바이트로 찾는다(앞의 jar 먼저). 클래스를 정의하지 않으므로(ofClassLoader와 달리) 라이브러리 클래스를
     * 패치하는 동안 다른 라이브러리 클래스가 정의되는 부작용이 없다. jar는 부르는 쪽이 열고 닫는다(멀티 릴리스 jar는 연 버전 기준).
     */
    static ClassHierarchy ofJars(List<JarFile> jars) {
        Map<String, ClassInfo> cache = new HashMap<>();
        Set<String> missing = new HashSet<>();
        return internalName -> {
            synchronized (cache) {
                ClassInfo info = cache.get(internalName);
                if (info != null || missing.contains(internalName)) return info;
                for (JarFile jar : jars) {
                    JarEntry entry = jar.getJarEntry(internalName + ".class");
                    if (entry == null) continue;
                    try (InputStream in = jar.getInputStream(entry)) {
                        info = ClassFile.readInfo(in.readAllBytes());
                    } catch (IOException | PatchException | RuntimeException e) {
                        info = null;
                    }
                    break;
                }
                if (info == null) missing.add(internalName);
                else cache.put(internalName, info);
                return info;
            }
        };
    }

    private static ClassInfo reflect(ClassLoader loader, String internalName) {
        Class<?> type;
        try {
            type = Class.forName(internalName.replace('/', '.'), false, loader);
        } catch (ClassNotFoundException | LinkageError e) {
            return null;
        }
        Set<String> methods = new HashSet<>();
        try {
            for (Method m : type.getDeclaredMethods()) {
                methods.add(m.getName() + MethodType.methodType(m.getReturnType(), m.getParameterTypes())
                        .toMethodDescriptorString());
            }
        } catch (LinkageError e) {
            // 메서드 서명의 형식을 읽지 못하는 클래스: 선언 정보 없이 상위 관계만 쓴다
        }
        Class<?> superType = type.getSuperclass();
        return new ClassInfo(internalName, superType == null ? null : superType.getName().replace('.', '/'),
                type.isInterface(), methods);
    }
}
