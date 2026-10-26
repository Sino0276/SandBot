package org.sandbot.sim;

/** 하드웨어 호출이 가는 허브. 같은 명령도 Expansion Hub는 RS-485를 한 번 더 거쳐 오래 걸린다. */
public enum HubKind {
    CONTROL,
    EXPANSION
}
