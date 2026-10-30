package org.sandbot.sim;

/**
 * FTC Dashboard 대체가 호스트에 보내는 것(런타임이 구현해 {@link SimDashboard#connect}로 준다, src/shared/sidecarProtocol.ts의
 * dash·dashConfig·notice). 글자는 Dashboard 대체가 만든 JSON이고 런타임은 그대로 싣는다. OpMode 스레드에서 부른다.
 */
public interface SimDashboardHost {
    /**
     * 패킷 묶음 하나(DashMessage).
     *
     * @param data JSON 배열 [[키, 값] …](키 정렬)
     * @param log JSON 배열 또는 null
     * @param ops JSON 배열(DashOp) 또는 null
     */
    void dash(long tNanos, boolean cleared, String data, String log, String ops);

    /** 설정 트리 전체(DashConfigNode JSON) */
    void dashConfig(long tNanos, String root);

    /** 안내(SidecarNoticeCode: dashCamera·dashImage), 매개변수 없음 */
    void notice(String code);
}
