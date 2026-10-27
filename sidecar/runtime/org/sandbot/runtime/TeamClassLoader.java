package org.sandbot.runtime;

import org.sandbot.runtime.patch.ClassHierarchy;
import org.sandbot.runtime.patch.ClassPatcher;
import org.sandbot.runtime.patch.PatchException;

import java.util.HashMap;
import java.util.Map;

/**
 * 이번에 컴파일한 팀 클래스만 정의하는 클래스 로더(부모 = 앱 로더: 가짜 SDK·sim·런타임). 정의하기 전에 ClassPatcher로 시간 API를
 * 가상 시계로 바꾼다. 부모를 먼저 찾으므로 팀이 SDK와 같은 이름의 클래스를 두면 SDK 것이 쓰인다(실제 앱 빌드에서는 충돌).
 * 라이브러리 jar 패치는 나중 단계.
 */
final class TeamClassLoader extends ClassLoader {
    static {
        registerAsParallelCapable();
    }

    private final Map<String, byte[]> classes;
    private final ClassPatcher patcher;

    /** @param classes 바이너리 이름(Outer$Inner) → 클래스 파일 */
    TeamClassLoader(Map<String, byte[]> classes, ClassLoader parent) {
        super("SandBotTeamCode", parent);
        this.classes = classes;
        Map<String, byte[]> byInternalName = new HashMap<>();
        for (Map.Entry<String, byte[]> e : classes.entrySet()) byInternalName.put(e.getKey().replace('.', '/'), e.getValue());
        this.patcher = new ClassPatcher(ClassHierarchy.chain(ClassHierarchy.ofClassFiles(byInternalName),
                ClassHierarchy.ofClassLoader(parent)));
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = classes.get(name);
        if (bytes == null) throw new ClassNotFoundException(name);
        byte[] patched;
        try {
            patched = patcher.apply(bytes).bytes;
        } catch (PatchException e) {
            // 패치하지 못한 클래스는 정의하지 않는다(진짜 시계를 쓰게 되므로): 팀 코드에는 NoClassDefFoundError로 보인다
            throw new ClassNotFoundException(name + " could not be prepared for the simulator: " + e.getMessage());
        }
        return defineClass(name, patched, 0, patched.length);
    }
}
