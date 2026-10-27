package org.sandbot.sim;

/**
 * 가상 시간을 쓰는 작업 종류. 비용은 {@link HubTiming}이 정한다(허브 종류마다 다를 수 있음).
 * 키 이름(HubTiming.KEYS)은 src/shared/sidecarProtocol.ts의 HUB_TIMING_KEYS와 같아야 한다.
 */
public enum SimCost {
    /** Lynx 명령 하나(모터 출력·모드·목표 위치 쓰기, 캐시 없이 읽는 엔코더·속도 등) */
    LYNX_COMMAND,
    /** bulk read 하나(BulkCachingMode AUTO·MANUAL에서 캐시를 채울 때) */
    BULK_READ,
    /** I2C 트랜잭션 하나(읽기 또는 쓰기) */
    I2C_TRANSACTION,
    /** 시계 읽기(System.nanoTime·currentTimeMillis 등). 바쁜 대기 루프에서도 시간이 흐르게 하는 아주 작은 값. */
    CLOCK_READ,
    /** 루프 표시 한 번(opModeIsActive·opModeInInit·idle) */
    LOOP_MARKER,
    /** telemetry.update가 실제로 보낼 때 */
    TELEMETRY_UPDATE
}
