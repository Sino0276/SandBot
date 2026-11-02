package com.qualcomm.robotcore.eventloop.opmode;

import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;

/**
 * 사이드카 런타임(org.sandbot.runtime)이 OpModeInternal의 package-private 훅을 부르는 문. 실제 SDK에서는 같은 패키지의
 * OpModeManagerImpl(이벤트 루프 스레드)이 부르던 것들이다. 팀 코드가 쓸 것이 아니다.
 *
 * <p>사이드카에는 이벤트 루프 스레드가 없다. 런타임이 OpMode 스레드에서 {@link #runOpModeOnThisThread}로 OpMode를 돌리고,
 * 틱 경계(가상 시계 호출 안, 같은 스레드)에서 {@link #start}·{@link #stop}·{@link #newGamepadData}·
 * {@link #eventLoopIteration}을 부른다.
 */
public final class SandbotOpModeBridge {
    private SandbotOpModeBridge() {}

    /** OpModeManagerImpl.runActiveOpMode가 INIT 때 하던 필드 설정 */
    public static void attach(OpMode opMode, Gamepad gamepad1, Gamepad gamepad2, HardwareMap hardwareMap,
            OpModeServices services) {
        opMode.gamepad1 = gamepad1;
        opMode.gamepad2 = gamepad2;
        opMode.hardwareMap = hardwareMap;
        opMode.internalOpModeServices = services;
    }

    /** internalInit의 상태 초기화(플래그, 텔레메트리, 게임패드 엣지 감지) */
    public static void init(OpMode opMode) {
        opMode.internalInit();
    }

    /**
     * 실제 OpMode 스레드 본문(init → … → stop, 또는 runOpMode). 사용자 코드의 RuntimeException·NoClassDefFoundError는
     * {@link #exception}으로 남고 여기서 던지지 않는다. 그 밖의 Error(SimExit·SimThreadError·StackOverflowError 등)는 던진다.
     */
    public static void runOpModeOnThisThread(OpMode opMode) {
        opMode.internalRunOpModeOnThisThread();
    }

    /** START(callActiveOpModeStart의 internalStart) */
    public static void start(OpMode opMode) {
        opMode.internalStart();
    }

    /** STOP(callActiveOpModeStop의 internalStop): stopRequested와 internalOnStopRequested(LinearOpMode는 끼어들기) */
    public static void stop(OpMode opMode) {
        opMode.internalStop();
    }

    /**
     * 게임패드 새 자료(runActiveOpMode와 같이: 이전에 넘긴 객체와 다를 때만 newGamepadDataAvailable). 런타임은 값이 바뀌었을 때만
     * 새 객체를 만든다.
     */
    public static void newGamepadData(OpMode opMode, Gamepad latest1, Gamepad latest2) {
        if (!latest1.equals(opMode.previousGamepad1Data) || !latest2.equals(opMode.previousGamepad2Data)) {
            opMode.newGamepadDataAvailable(latest1, latest2);
            opMode.previousGamepad1Data = latest1;
            opMode.previousGamepad2Data = latest2;
        }
    }

    /** 이벤트 루프 한 바퀴(checkOnActiveOpMode의 internalOnEventLoopIteration) */
    public static void eventLoopIteration(OpMode opMode) {
        opMode.internalOnEventLoopIteration();
    }

    /**
     * 사이드카의 OpMode 관리자(OpModeManagerImpl.getOpModeManagerOfActivity가 주는 것과 같다). hardwareMap은 이것을 notifier로
     * 받아 리스너를 등록하고, 팀 코드·라이브러리도 registerListener로 OpMode 수명 알림을 받는다.
     */
    public static OpModeManagerImpl manager() {
        return OpModeManagerImpl.sandbotManager();
    }

    /** 실행할 OpMode를 만들었다(registerListener가 돌려주는 지금 OpMode). null이면 끝났다. */
    public static void setActiveOpMode(OpMode opMode) {
        manager().sandbotSetActiveOpMode(opMode);
    }

    /**
     * OpMode 수명 알림(callActiveOpModeInit의 앞부분): 등록한 리스너(등록 순서) → hardwareMap의 Notifications 장치. 리스너가
     * 던진 것은 그대로 나간다(런타임이 정한다).
     */
    public static void notifyPreInit(OpMode opMode, HardwareMap hardwareMap) {
        manager().sandbotNotify(0, opMode, hardwareMap);
    }

    /** callActiveOpModeStart의 앞부분(internalStart 전) */
    public static void notifyPreStart(OpMode opMode, HardwareMap hardwareMap) {
        manager().sandbotNotify(1, opMode, hardwareMap);
    }

    /** callActiveOpModeStop의 끝(OpMode 본문이 끝난 뒤) */
    public static void notifyPostStop(OpMode opMode, HardwareMap hardwareMap) {
        manager().sandbotNotify(2, opMode, hardwareMap);
    }

    /** OpMode 스레드에서 남은 예외(RuntimeException 또는 NoClassDefFoundError), 없으면 null */
    public static Throwable exception(OpMode opMode) {
        if (opMode.exception != null) return opMode.exception;
        return opMode.noClassDefFoundError;
    }

    /** terminateOpModeNow()가 던진 것인가 */
    public static boolean isForceStop(Throwable t) {
        return t instanceof OpModeManagerImpl.ForceStopException;
    }

    public static boolean isStarted(OpMode opMode) {
        return opMode.isStarted;
    }

    public static boolean isStopRequested(OpMode opMode) {
        return opMode.stopRequested;
    }

    public static boolean isFinished(OpMode opMode) {
        return opMode.opModeThreadFinished;
    }
}
