package org.sandbot.sim;

/**
 * 팀 코드가 보는 시계. 지금 구현은 런타임의 VirtualClock(가상 시계) 하나다.
 *
 * <p>사이드카 안에서 시간을 다루는 모든 곳(패치한 System.nanoTime·Thread.sleep 등, 가짜 SDK의 하드웨어 비용 청구)은
 * 이 인터페이스만 거친다. 그래서 나중에 실시간 시계(진짜 시계로 돌면서 charge에서 실제로 기다리는 구현)를 더해도
 * 가짜 SDK·패처·프로토콜은 바뀌지 않는다(src/shared/sidecarProtocol.ts의 RunRequest.clock).
 *
 * <p>1단계는 OpMode 스레드 하나만 시계를 쓴다. 다른 스레드가 부르면 구현이 오류로 알리고 실행을 멈춘다.
 */
public interface SimClock {
    /** 실행 시작부터의 단조 나노초(팀 코드의 System.nanoTime 값). 부르기만 해서는 시간이 흐르지 않는다. */
    long nanoTime();

    /** 팀 코드의 System.currentTimeMillis 값(시작 벽시계 시각 + 흐른 가상 시간) */
    long currentTimeMillis();

    /**
     * 하드웨어·SDK 작업에 시간이 든다. 가상 시간을 nanos만큼 보낸다. 끼어들기(interrupt)로 끝나지 않고 플래그도
     * 건드리지 않는다. 틱 경계를 넘으면 그 안에서 호스트와 틱을 주고받는다(입력·DS 사건 적용, 일시 정지 중이면 멈춤).
     */
    void charge(long nanos);

    /**
     * Thread.sleep과 같다. 끼어들기가 있으면(이미 있거나 기다리는 중에 생기면) 플래그를 지우고 InterruptedException을
     * 던진다. nanos가 0 이하면 끼어들기만 확인한다.
     */
    void sleep(long nanos) throws InterruptedException;

    /**
     * 다음 틱 경계(실제 Robot Controller의 다음 이벤트 루프 한 바퀴)까지 기다린다. 경계에 이미 있으면 다음 경계까지.
     * 끼어들기는 sleep과 같다.
     */
    void awaitNextTick() throws InterruptedException;

    /** 틱 길이(나노초) */
    long tickNanos();
}
