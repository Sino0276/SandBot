package org.sandbot.sim;

import java.util.List;

/**
 * FTC Dashboard 대체(sandbot-dashboard.jar의 FtcDashboard)가 런타임에 주는 것(라이브러리 L2). sim은 Dashboard 형식을 모르므로
 * 이름·글자로만 주고받는다. FtcDashboard가 클래스 초기화 때 {@link Sim#attachDashboard}로 넣고, 런타임이 OpMode 스레드에서
 * 부른다. 보내는 것은 {@link SimDashboardHost}로 간다.
 */
public interface SimDashboard {
    /** 보낼 곳(처음 한 번). 그 전에 쌓인 패킷·설정은 다음 경계에 보낸다. */
    void connect(SimDashboardHost host);

    /**
     * 실제 FtcDashboard.addConfigClasses(시작할 때 한 번): 이름의 클래스 중 @Config가 있고 SDK @Disabled가 없는 것을 설정 트리에
     * 넣는다(이름 접두 java·android·com.sun·com.vuforia·com.google·kotlin은 건너뛴다, 정적 초기화는 그때 돈다).
     *
     * @param names 컴파일한 팀 클래스와 라이브러리 클래스 중 상수 풀에 Config 애너테이션이 있는 것의 바이너리 이름(이름순)
     */
    void addConfigClasses(ClassLoader loader, List<String> names);

    /**
     * 틱 경계: Config 탭의 값 바꾸기(paths[i]에 values[i])를 차례로 적용하고, 보낼 때가 된 패킷 묶음과 바뀐 설정 트리를 보낸다.
     *
     * @param tNanos 경계의 가상 시각(보내는 메시지의 tNanos)
     */
    void tickBoundary(long tNanos, List<List<String>> paths, List<String> values);

    /** 끝내기 전: 남은 패킷·설정 트리를 모두 보낸다 */
    void flush(long tNanos);
}
