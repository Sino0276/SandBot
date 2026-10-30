package org.sandbot.runtime;

import org.sandbot.runtime.patch.ClassHierarchy;
import org.sandbot.sim.HubTiming;
import org.sandbot.sim.Sim;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * JVM 사이드카 진입점(spec §R-1, 프로토콜은 src/shared/sidecarProtocol.ts).
 *
 * <p>원래 stdout은 프로토콜 전용으로 잡고 System.out·System.err는 가로채 log 메시지로 보낸다. 흐름:
 * hello → run 읽기·확인 → (라이브러리가 있으면) jar 열기·링크 검사(linkReport) → 컴파일(compiled, OpMode·등록기 소스) →
 * 가상 시계·Hub 타이밍·호스트·모의 저장소를 Sim에 넣기 → OpMode 스레드(OpModeRunner, 클래스는 TeamClassLoader →
 * LibraryClassLoader → 앱 로더) → finished → Runtime.halt(0). run 대신 list(등록기 OpMode 목록)면 같은 준비 뒤 ListRunner가
 * 등록기를 실행해 registered → finished listed. 어느 길로 끝나도 finished를 한 번 보낸다(stdout을 쓸 수 없을 때만 빼고).
 */
public final class Main {
    private Main() {}

    /** 실행 하나의 공용 상태: 프로토콜 출력과 "한 번만 끝내기" */
    static final class Session implements HostInput.Handler {
        final Protocol protocol;
        private volatile VirtualClock clock;
        private volatile boolean running;
        private final Object finishLock = new Object();
        private boolean finishing;
        private OutputCapture outCapture;
        private OutputCapture errCapture;

        Session(Protocol protocol) {
            this.protocol = protocol;
        }

        long nanos() {
            VirtualClock c = clock;
            return c == null ? 0 : c.peekNanos();
        }

        /** 끝내기를 시작할 권리. 처음 부른 쪽만 true(나머지는 halt를 기다린다). */
        boolean beginFinish() {
            synchronized (finishLock) {
                if (finishing) return false;
                finishing = true;
                return true;
            }
        }

        /** 팀 코드 출력의 남은 줄(줄바꿈 없는 끝) */
        void flushOutput() {
            System.out.flush();
            System.err.flush();
            if (outCapture != null) outCapture.flushPartial();
            if (errCapture != null) errCapture.flushPartial();
        }

        @Override
        public void protocolError(String message) {
            if (!beginFinish()) return;
            protocol.error(nanos(), "internal", "protocol error: " + message, null, new ArrayList<>(),
                    Thread.currentThread().getName());
            flushOutput();
            protocol.finished(nanos(), running ? "exception" : "loadFailed");
            halt();
        }

        /** 감시가 끝낸다(OpMode 스레드가 응답하지 않음) */
        void forceFinish(String reason) {
            if (!beginFinish()) return;
            flushOutput();
            protocol.finished(nanos(), reason);
            halt();
        }

        @Override
        public void shutdown() {
            if (!beginFinish()) return;
            flushOutput();
            protocol.finished(nanos(), "shutdown");
            halt();
        }

        @Override
        public void endOfInput() {
            // 호스트가 없어졌다: 보낼 곳이 없을 수 있지만 할 수 있으면 알린다
            shutdown();
        }
    }

    public static void main(String[] args) {
        // Control Hub처럼(그리고 PC 지역 설정과 관계없이 같은 결과가 나오게) 기본 지역은 en-US
        Locale.setDefault(Locale.US);
        Protocol protocol = new Protocol(new BufferedOutputStream(new FileOutputStream(FileDescriptor.out), 1 << 16));
        Session session = new Session(protocol);
        session.outCapture = new OutputCapture("out", (stream, text) -> protocol.log(session.nanos(), stream, text));
        session.errCapture = new OutputCapture("err", (stream, text) -> protocol.log(session.nanos(), stream, text));
        try {
            System.setOut(new java.io.PrintStream(session.outCapture, true, StandardCharsets.UTF_8.name()));
            System.setErr(new java.io.PrintStream(session.errCapture, true, StandardCharsets.UTF_8.name()));
        } catch (java.io.UnsupportedEncodingException e) {
            throw new AssertionError(e);
        }
        try {
            run(session);
        } catch (Throwable t) {
            if (session.beginFinish()) {
                protocol.error(session.nanos(), "internal", "sidecar runtime failure: " + StackFrames.describe(t),
                        t.getClass().getName(), StackFrames.of(t.getStackTrace(), new java.util.HashMap<>(), false),
                        Thread.currentThread().getName());
                protocol.finished(session.nanos(), "loadFailed");
                halt();
            }
        }
        parkForever();
    }

    private static void run(Session session) throws IOException {
        Protocol protocol = session.protocol;
        protocol.hello(sourceHash(), System.getProperty("java.version"));
        HostInput input = new HostInput(new FileInputStream(FileDescriptor.in), session);
        input.start();

        HostInput.Message first = input.take();
        if ("list".equals(first.type)) {
            runList(session, first);
            return;
        }
        if (!"run".equals(first.type)) {
            session.protocolError("expected run but got " + first.type);
            parkForever();
        }
        RunRequest request;
        try {
            request = RunRequest.parse(first.body);
        } catch (RunRequest.Invalid e) {
            failBeforeRun(session, e.getMessage(), "loadFailed");
            return;
        }

        // 라이브러리(실행 클래스패스): 열기 → 링크 검사(linkReport, compiled 전)
        ClassLoader appLoader = Main.class.getClassLoader();
        LibraryJars libraries = openLibraries(session, request.libraryClasspath, appLoader);

        // 컴파일(시작 파일: OpMode 소스와 등록기 소스)
        TeamCompiler.Result compiled = compile(session, request.sourceRoots,
                RunRequest.startFiles(request.opModeSource, request.registrars), request.bootClasspath,
                request.compileClasspath);

        // 시뮬레이터
        HubTiming timing;
        try {
            timing = new HubTiming(request.timing, request.jitter, request.seed);
        } catch (IllegalArgumentException e) {
            failBeforeRun(session, e.getMessage(), "loadFailed");
            return;
        }
        OpModeRunner[] runnerRef = new OpModeRunner[1];
        VirtualClock clock = new VirtualClock(request.tickNanos, request.startEpochMillis,
                (thread, message, stack) -> runnerRef[0].reportForeignThread(thread, message, stack));
        TeamClassLoader loader = teamLoader(compiled, libraries, appLoader);
        OpModeRunner runner = new OpModeRunner(session, clock, input, request, loader, compiled.sources,
                HardwareHooks.load(appLoader));
        runnerRef[0] = runner;
        session.clock = clock;
        session.running = true;
        Sim.installFirstFolder(new File(request.firstFolder));
        Sim.install(clock, timing, runner);
        clock.setBoundary(runner);

        Thread thread = new Thread(runner::run, "OpModeThread");
        thread.setContextClassLoader(loader);
        clock.setOwner(thread);
        new Watchdog(clock, runner, session, request.stallMillis, false).start();
        thread.start();
    }

    /**
     * 등록기 OpMode 목록(ListRequest): (라이브러리 → linkReport) → 컴파일(등록기 소스) → OpMode 스레드에서 등록기 실행
     * (ListRunner) → registered → finished listed. 틱을 열지 않으므로 호스트를 기다리지 않는다.
     */
    private static void runList(Session session, HostInput.Message first) throws IOException {
        ListRequest request;
        try {
            request = ListRequest.parse(first.body);
        } catch (RunRequest.Invalid e) {
            failBeforeRun(session, e.getMessage(), "loadFailed");
            return;
        }
        ClassLoader appLoader = Main.class.getClassLoader();
        LibraryJars libraries = openLibraries(session, request.libraryClasspath, appLoader);
        TeamCompiler.Result compiled = compile(session, request.sourceRoots,
                RunRequest.startFiles(null, request.registrars), request.bootClasspath, request.compileClasspath);

        ListRunner[] runnerRef = new ListRunner[1];
        VirtualClock clock = new VirtualClock(request.tickNanos, request.startEpochMillis,
                (thread, message, stack) -> runnerRef[0].reportForeignThread(thread, message, stack));
        TeamClassLoader loader = teamLoader(compiled, libraries, appLoader);
        ListRunner runner = new ListRunner(session, clock, request, loader, compiled.sources);
        runnerRef[0] = runner;
        session.clock = clock;
        session.running = true;
        Sim.installFirstFolder(new File(request.firstFolder));
        Sim.install(clock, HubTiming.defaults(), runner);

        Thread thread = new Thread(runner::run, "OpModeThread");
        thread.setContextClassLoader(loader);
        clock.setOwner(thread);
        new Watchdog(clock, runner, session, request.stallMillis, true).start();
        thread.start();
    }

    /** 실행 클래스패스의 라이브러리를 열고 링크 검사(linkReport)를 보낸다. 없으면 null. 열지 못하면 끝낸다(돌아오지 않음). */
    private static LibraryJars openLibraries(Session session, List<String> libraryClasspath, ClassLoader appLoader) {
        if (libraryClasspath.isEmpty()) return null;
        LibraryJars libraries;
        try {
            libraries = LibraryJars.open(libraryClasspath);
        } catch (IOException e) {
            failBeforeRun(session, e.getMessage(), "loadFailed");
            throw new AssertionError(e);
        }
        List<Map<String, Object>> warnings = new ArrayList<>();
        for (LinkCheck.Warning w : new LinkCheck(libraries, appLoader).run()) warnings.add(w.toJson());
        session.protocol.linkReport(warnings);
        return libraries;
    }

    /** 컴파일하고 compiled를 보낸다. 실패하면 끝낸다(돌아오지 않음). */
    private static TeamCompiler.Result compile(Session session, List<String> sourceRoots, List<String> startFiles,
            List<String> bootClasspath, List<String> compileClasspath) throws IOException {
        long started = System.nanoTime();
        TeamCompiler.Result compiled;
        try {
            compiled = TeamCompiler.compile(sourceRoots, startFiles, bootClasspath, compileClasspath);
        } catch (TeamCompiler.NoCompilerException e) {
            failBeforeRun(session, e.getMessage(), "compileFailed");
            throw new AssertionError(e);
        }
        long millis = (System.nanoTime() - started) / 1_000_000L;
        session.protocol.compiled(compiled.ok, compiled.diagnostics, millis);
        if (!compiled.ok) {
            if (session.beginFinish()) {
                session.protocol.finished(0, "compileFailed");
                halt();
            }
            parkForever();
        }
        return compiled;
    }

    /** 팀 로더 → (라이브러리 로더 →) 앱 로더. 둘 다 정의할 때 같은 패치를 건다. */
    private static TeamClassLoader teamLoader(TeamCompiler.Result compiled, LibraryJars libraries,
            ClassLoader appLoader) {
        if (libraries != null) {
            LibraryClassLoader libraryLoader = new LibraryClassLoader(libraries, appLoader);
            return new TeamClassLoader(compiled.classes, libraryLoader, libraryLoader.hierarchy);
        }
        return new TeamClassLoader(compiled.classes, appLoader, ClassHierarchy.ofClassLoader(appLoader));
    }

    private static void failBeforeRun(Session session, String message, String reason) {
        if (!session.beginFinish()) parkForever();
        session.protocol.error(0, "internal", message, null, new ArrayList<>(), Thread.currentThread().getName());
        session.protocol.finished(0, reason);
        halt();
    }

    /** 빌드가 runtime jar에 넣는 소스 해시(T의 build-sidecar: org/sandbot/runtime/source-hash.txt). 없으면 "dev". */
    static String sourceHash() {
        try (InputStream in = Main.class.getResourceAsStream("/org/sandbot/runtime/source-hash.txt")) {
            if (in == null) return "dev";
            String hash = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
            return hash.isEmpty() ? "dev" : hash;
        } catch (IOException e) {
            return "dev";
        }
    }

    static void halt() {
        Runtime.getRuntime().halt(0);
    }

    /** 다른 스레드가 끝내는 중이다: halt를 기다린다 */
    static void parkForever() {
        for (;;) {
            try {
                Thread.sleep(Long.MAX_VALUE);
            } catch (InterruptedException ignored) {
                // halt가 올 때까지
            }
        }
    }
}
