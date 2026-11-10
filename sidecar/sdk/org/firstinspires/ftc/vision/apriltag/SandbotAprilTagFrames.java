package org.firstinspires.ftc.vision.apriltag;

import org.sandbot.sdk.devices.SimCameraFrame;

import java.util.ArrayList;

/**
 * VisionPortalImpl(다른 패키지)이 AprilTagProcessorImpl의 패키지 안 경로를 부르는 다리(SandbotOpModeBridge와 같은 방식,
 * spec-4d §1.9). SDK에 없는 SandBot 클래스라 이름이 Sandbot으로 시작한다(ApiCheck).
 */
public final class SandbotAprilTagFrames {
    private SandbotAprilTagFrames() {}

    /** 이 처리기가 SandBot AprilTag 처리기인가(팀 VisionProcessor·ColorBlob 등은 아니다) */
    public static boolean isAprilTag(Object processor) {
        return processor instanceof AprilTagProcessorImpl;
    }

    /**
     * 프레임 하나를 처리해 검출 목록을 만든다(대기 중 setDecimation을 이 프레임에 적용, 캡처 시각 = frameNanos). 자세 풀이의
     * OpenCV 예외(CvException)는 던진다. 결과는 아직 처리기에 넣지 않는다({@link #publish}).
     */
    public static ArrayList<AprilTagDetection> process(Object processor, SimCameraFrame frame) {
        return ((AprilTagProcessorImpl) processor).sandbotProcess(frame);
    }

    /** 처리 결과를 처리기의 detections·detectionsUpdate에 넣는다(결과 시각의 경계에서) */
    public static void publish(Object processor, ArrayList<AprilTagDetection> detections) {
        ((AprilTagProcessorImpl) processor).sandbotPublish(detections);
    }

    /** 처리기의 TagFamily 이름 */
    public static String family(Object processor) {
        return ((AprilTagProcessorImpl) processor).sandbotFamily().name();
    }

    /** 다음 처리 프레임에 쓸 데시메이션(대기 중 setDecimation 값, 없으면 지금 값, 처음 3) */
    public static float pendingDecimation(Object processor) {
        return ((AprilTagProcessorImpl) processor).sandbotNextDecimation();
    }

    /** 지금 검출기가 쓰는 데시메이션(마지막 처리 프레임에 적용한 값, 처음 3) */
    public static float appliedDecimation(Object processor) {
        return ((AprilTagProcessorImpl) processor).sandbotAppliedDecimation();
    }

    /** 지금 자세 풀이 이름(PoseSolver, 정지 안내 visionSolverStop의 solver) */
    public static String poseSolver(Object processor) {
        return ((AprilTagProcessorImpl) processor).sandbotPoseSolver().name();
    }

    /** setDecimation 때 부를 것(포털이 웹캠 출력을 다시 쓴다) */
    public static void setChangeListener(Object processor, Runnable listener) {
        ((AprilTagProcessorImpl) processor).sandbotSetChangeListener(listener);
    }
}
