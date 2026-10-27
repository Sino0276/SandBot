package org.sandbot.sdk.devices;

/**
 * 로봇 구성 XML을 읽지 못했거나 시뮬레이터가 지원하지 않는 장치가 있다. 메시지는 사용자에게 가는 영어 문장이다
 * (런타임이 error kind "config"로 보낸다).
 */
public class SandbotConfigException extends Exception {
    public SandbotConfigException(String message) {
        super(message);
    }

    public SandbotConfigException(String message, Throwable cause) {
        super(message, cause);
    }
}
