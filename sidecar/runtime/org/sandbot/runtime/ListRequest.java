package org.sandbot.runtime;

import java.util.List;
import java.util.Map;

/**
 * 호스트의 list 메시지(src/shared/sidecarProtocol.ts의 ListRequest)를 검사해 읽은 것: 등록기 OpMode 목록 요청. 컴파일하고
 * 등록기를 실행해 registered를 보낸 뒤 finished(listed)로 끝난다. hardwareMap·틱 교환은 없다.
 */
final class ListRequest {
    final long tickNanos;
    final List<String> sourceRoots;
    /** 하나 이상(컴파일 시작 파일이자 실행할 등록기) */
    final List<RunRequest.Registrar> registrars;
    final List<String> bootClasspath;
    final List<String> compileClasspath;
    final List<String> libraryClasspath;
    final String firstFolder;
    final long startEpochMillis;
    final long stallMillis;

    private ListRequest(Map<String, Object> m) throws RunRequest.Invalid {
        RunRequest.checkProtocolAndClock(m);
        tickNanos = RunRequest.positiveLong(m, "tickNanos");
        sourceRoots = RunRequest.stringList(m, "sourceRoots");
        registrars = RunRequest.registrars(m);
        if (registrars.isEmpty()) throw new RunRequest.Invalid("registrars must not be empty");
        bootClasspath = RunRequest.stringList(m, "bootClasspath");
        compileClasspath = RunRequest.stringList(m, "compileClasspath");
        libraryClasspath = RunRequest.stringList(m, "libraryClasspath");
        firstFolder = RunRequest.string(m, "firstFolder");
        startEpochMillis = RunRequest.integer(m, "startEpochMillis");
        stallMillis = RunRequest.positiveLong(m, "stallMillis");
    }

    static ListRequest parse(Map<String, Object> message) throws RunRequest.Invalid {
        return new ListRequest(message);
    }
}
