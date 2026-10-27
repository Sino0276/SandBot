package org.sandbot.runtime.patch;

/** 클래스 파일을 패치하지 못했다(형식 오류, 지원하지 않는 버전, 상수 풀이 65535를 넘음 등). 메시지는 영어. */
public final class PatchException extends Exception {
    public PatchException(String message) {
        super(message);
    }
}
