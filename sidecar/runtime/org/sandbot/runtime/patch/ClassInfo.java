package org.sandbot.runtime.patch;

import java.util.Collections;
import java.util.Set;

/**
 * 패처가 상속 관계를 판단할 때 쓰는 클래스 요약: 상위 클래스와 직접 선언한 메서드(이름 + 서술자).
 * 예: 팀의 {@code class Worker extends Thread}가 {@code sleep(10)}을 부르면 javac는 {@code Worker.sleep(J)V}로 적으므로,
 * Worker가 Thread의 하위 클래스이고 sleep(J)V를 스스로 선언하지 않았는지 알아야 바꿀 수 있다.
 */
public final class ClassInfo {
    /** 내부 이름(java/lang/Thread). java/lang/Object와 인터페이스의 상위는 null이 아니라 java/lang/Object일 수 있다. */
    public final String name;
    /** 상위 클래스 내부 이름(java/lang/Object이면 null) */
    public final String superName;
    public final boolean isInterface;
    /** 직접 선언한 메서드: 이름 + 서술자(예: "sleep(J)V") */
    public final Set<String> methods;

    public ClassInfo(String name, String superName, boolean isInterface, Set<String> methods) {
        this.name = name;
        this.superName = superName;
        this.isInterface = isInterface;
        this.methods = Collections.unmodifiableSet(methods);
    }

    public boolean declares(String methodName, String descriptor) {
        return methods.contains(methodName + descriptor);
    }
}
