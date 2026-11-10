/*
 * Copyright (c) 2023 FIRST
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted (subject to the limitations in the disclaimer below) provided that
 * the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list
 * of conditions and the following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright notice, this
 * list of conditions and the following disclaimer in the documentation and/or
 * other materials provided with the distribution.
 *
 * Neither the name of FIRST nor the names of its contributors may be used to
 * endorse or promote products derived from this software without specific prior
 * written permission.
 *
 * NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS
 * LICENSE. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
// SandBot: 실제 12.0 소스에서 출발했다(spec-4d §1.10). 실제는 EOCV 카메라(OpenCvWebcam)와 카메라·상태 스레드로 돈다. SandBot에는
// 카메라 스레드가 없어 같은 상태 기계를 가상 시간으로 돌린다: 상태 전이와 프레임은 OpMode 스레드의 틱 경계 듣기(Sim.BoundaryListener)
// 에서만 바뀐다. 전이 시간은 [가정: 포털 전이 시간] 열기 1.0 s, 스트림 시작 0.5 s, 멈춤 0.3 s, 닫기 0.3 s이고 끝은 그 시각 이후 첫
// 경계에서 적용한다. userStateSemaphore가 줄 세우던 호출(stop·resume·close)은 진행 중 전이가 끝날 때까지 awaitNextTick으로
// 기다린다. 프레임은 웹캠 입력(시뮬레이터 원시 검출)이고 처리 시간 [가정: 처리 시간 표](640×480 기준 데시메이션 1·2·3에서
// 100·45·22 ms, 픽셀 수에 비례) 뒤 첫 경계에서 처리기의 결과가 바뀐다. 처리 중에 온 프레임은 가장 최근 것 하나만 기다린다
// [가정: 최신 프레임 하나 대기]. FPS는 EOCV OpenCvCameraBase처럼 처리 시작 간격 30개의 평균이다. 불투명 EOCV 형식인 protected
// 필드(camera·CAMERA_ROTATION)는 늘 null이고, 실제 코드의 camera != null 판정은 SandBot 웹캠이 열려 있는지로 바꿨다. 바꾼 줄은 모두
// "// SandBot:"이다.
package org.firstinspires.ftc.vision;

import android.graphics.Bitmap;
import android.util.Size;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.util.MovingStatistics;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.function.Consumer;
import org.firstinspires.ftc.robotcore.external.function.Continuation;
import org.firstinspires.ftc.robotcore.external.hardware.camera.CameraName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.CameraControl;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibration;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibrationIdentity;
import org.firstinspires.ftc.robotcore.internal.system.AppUtil;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.SandbotAprilTagFrames;
import org.openftc.easyopencv.OpenCvCamera;
import org.opencv.core.CvException;
import org.openftc.easyopencv.OpenCvCameraRotation;
import org.sandbot.sdk.devices.SandbotCameraCalibrations;
import org.sandbot.sdk.devices.SandbotCameraModels;
import org.sandbot.sdk.devices.SimCamera;
import org.sandbot.sdk.devices.SimCameraFrame;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimUnsupportedException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.Semaphore;

public class VisionPortalImpl extends VisionPortal
{
    // SandBot: EOCV 카메라(불투명 형식)는 만들지 않는다. 늘 null
    protected OpenCvCamera camera;
    protected final int cameraMonitorViewId;
    protected volatile CameraState cameraState = CameraState.CAMERA_DEVICE_CLOSED;
    protected VisionProcessor[] processors;
    protected volatile boolean[] processorsEnabled;
    protected volatile CameraCalibration calibration;
    protected final boolean autoPauseCameraMonitor;
    protected final boolean autoStartStream;
    protected final boolean showStats;
    // SandBot: 실제처럼 두지만 쓰지 않는다(OpMode 스레드 하나라 진행 중 전이를 기다리는 것으로 대신한다)
    protected final Semaphore userStateSemaphore = new Semaphore(1);
    protected final Size cameraResolution;
    protected final StreamFormat webcamStreamFormat;
    // SandBot: 실제는 OpenCvCameraRotation.SENSOR_NATIVE(불투명 enum이라 상수가 없다)
    protected static final OpenCvCameraRotation CAMERA_ROTATION = null;
    protected String captureNextFrame;
    protected final Object captureFrameMtx = new Object();
    protected OpModeNotificationsListener opModeNotificationsListener = new OpModeNotificationsListener();

    // !! STATIC !! MUST PERSIST ACROSS INSTANCES
    protected static final Object viewUseMtx = new Object();
    protected static ArrayList<Integer> viewsInUse = new ArrayList<>();

    // SandBot: 가상 시간 상태 기계 ------------------------------------------------------------------------------------------

    /** [가정: 포털 전이 시간] 열기·스트림 시작·멈춤·닫기(ns) */
    private static final long SANDBOT_OPEN_NANOS = 1_000_000_000L;
    private static final long SANDBOT_START_NANOS = 500_000_000L;
    private static final long SANDBOT_STOP_NANOS = 300_000_000L;
    private static final long SANDBOT_CLOSE_NANOS = 300_000_000L;
    /** EOCV OpenCvCameraBase의 FPS 표본 수(MovingStatistics(30), OpenCvCameraBase.java:171) */
    private static final int SANDBOT_FPS_SAMPLES = 30;

    private static final int SANDBOT_NONE = 0;
    private static final int SANDBOT_OPEN = 1;
    private static final int SANDBOT_START = 2;
    private static final int SANDBOT_STOP = 3;
    private static final int SANDBOT_CLOSE = 4;

    /** 이 포털의 SandBot 웹캠(실제 camera != null 대응: CAMERA_DEVICE_CLOSED가 되면 null) */
    private SimCamera sandbotCamera;
    private boolean sandbotOpenFailed;
    private int sandbotTransition = SANDBOT_NONE;
    private long sandbotTransitionEnd;
    private MovingStatistics sandbotIntervals = new MovingStatistics(SANDBOT_FPS_SAMPLES);
    private long sandbotLastStartNanos;
    private float sandbotFps;
    private long sandbotLastFrameNanos = Long.MIN_VALUE;
    private SandbotWork sandbotInFlight;
    private SimCameraFrame sandbotWaiting;
    private boolean sandbotProcessorsInitialized;
    private boolean sandbotMultipleNotified;
    private final Sim.BoundaryListener sandbotListener = new Sim.BoundaryListener()
    {
        @Override public void afterInputs(long boundaryNanos)
        {
            sandbotBoundary(boundaryNanos);
        }
    };

    /** 처리 중인 프레임: 처리기마다의 결과(켜지지 않았거나 AprilTag 처리기가 아니면 null)와 끝 시각, 자세 풀이 예외 */
    private static final class SandbotWork
    {
        final long end;
        final ArrayList<?>[] results;
        final RuntimeException error;
        final String errorSolver;

        SandbotWork(long end, ArrayList<?>[] results, RuntimeException error, String errorSolver)
        {
            this.end = end;
            this.results = results;
            this.error = error;
            this.errorSolver = errorSolver;
        }
    }

    protected class OpModeNotificationsListener implements OpModeManagerNotifier.Notifications
    {
        @Override public void onOpModePreInit(OpMode opMode) {}
        @Override public void onOpModePreStart(OpMode opMode) {}

        @Override
        public void onOpModePostStop(OpMode opMode)
        {
            synchronized (viewUseMtx)
            {
                if (cameraMonitorViewId != 0 && viewsInUse.contains(cameraMonitorViewId))
                {
                    viewsInUse.remove(Integer.valueOf(cameraMonitorViewId));
                }
            }
        }
    }

    public VisionPortalImpl(CameraName camera, int cameraMonitorViewId, boolean autoPauseCameraMonitor,
                            Size cameraResolution, StreamFormat webcamStreamFormat, boolean autoStartStream, boolean showStats,
                            VisionProcessor[] processors)
    {
        synchronized (viewUseMtx)
        {
            if (cameraMonitorViewId != 0)
            {
                if (viewsInUse.contains(cameraMonitorViewId))
                {
                    if (cameraMonitorViewId == VisionPortal.DEFAULT_VIEW_CONTAINER_ID)
                    {
                        throw new IllegalStateException("When using multiple vision portals, you MUST use setLiveViewContainerId(int), NOT enableLiveView(bool)");
                    }
                    else
                    {
                        throw new IllegalStateException("User code attempted to set up multiple LiveViews with the same View ID. If you are using makeMultiPortalView(...), make sure you are using different index values on the returned array for each portal.");
                    }
                }
                else
                {
                    if (viewsInUse.contains(DEFAULT_VIEW_CONTAINER_ID) || (viewsInUse.size() > 0 && cameraMonitorViewId == DEFAULT_VIEW_CONTAINER_ID))
                    {
                        throw new IllegalStateException("Misconfigured MultiPortal View IDs for LiveView. Make sure you are using setLiveViewContainerId(int) for ALL portals");
                    }

                    viewsInUse.add(cameraMonitorViewId);
                    OpModeManagerImpl.getOpModeManagerOfActivity(AppUtil.getInstance().getActivity()).registerListener(opModeNotificationsListener);
                }
            }
        }

        this.processors = processors;
        this.cameraMonitorViewId = cameraMonitorViewId;
        this.cameraResolution = cameraResolution;
        this.webcamStreamFormat = webcamStreamFormat;
        processorsEnabled = new boolean[processors.length];

        for (int i = 0; i < processors.length; i++)
        {
            processorsEnabled[i] = true;
        }

        this.autoPauseCameraMonitor = autoPauseCameraMonitor;
        this.showStats = showStats;
        this.autoStartStream = autoStartStream;

        // SandBot: 영상이 필요한 처리기(팀 VisionProcessor·ColorBlob·PredominantColor)는 프레임을 받지 않는다 — 알린다
        for (VisionProcessor processor : processors)
        {
            if (!SandbotAprilTagFrames.isAprilTag(processor))
            {
                sandbotNotice("visionProcessorUnsupported", "processor", processor.getClass().getName());
            }
            else
            {
                SandbotAprilTagFrames.setChangeListener(processor, new Runnable()
                {
                    @Override public void run()
                    {
                        sandbotPublish();
                    }
                });
            }
        }

        createCamera(camera, cameraMonitorViewId);
        startCamera();
    }

    protected void startCamera()
    {
        // SandBot: 실제 camera == null 판정
        if (sandbotCamera == null)
        {
            throw new IllegalStateException("This should never happen");
        }

        if (cameraResolution == null) // was the user a silly silly
        {
            throw new IllegalArgumentException("parameters.cameraResolution == null");
        }

        // SandBot: 실제는 camera.showFpsMeterOnViewport·setViewportRenderer(LiveView)와 userStateSemaphore.acquireUninterruptibly() 뒤
        // camera.openCameraDeviceAsync(…)(카메라 스레드의 onOpened·onError). 같은 웹캠을 다른 포털이 잡고 있으면 열기 시간 뒤 ERROR다
        // [가정: 같은 카메라 두 번 열기는 실패]
        sandbotAcquire();
        cameraState = CameraState.OPENING_CAMERA_DEVICE;
        sandbotOpenFailed = !sandbotCamera.claim(this);
        sandbotBegin(SANDBOT_OPEN, Sim.nanoTime() + SANDBOT_OPEN_NANOS);
        Sim.addBoundaryListener(sandbotListener);
        sandbotPublish();
    }

    protected void createCamera(CameraName cameraName, int cameraMonitorViewId)
    {
        if (cameraName == null) // was the user a silly silly
        {
            throw new IllegalArgumentException("parameters.camera == null");
        }
        else if (cameraName.isWebcam()) // Webcams
        {
            // SandBot: 실제는 OpenCvCameraFactory.getInstance().createWebcam(…)(EOCV). 구성의 SandBot 웹캠을 쓴다
            sandbotCamera = SimCamera.of(cameraName);
            if (sandbotCamera == null)
            {
                throw new SimUnsupportedException("org.firstinspires.ftc.vision.VisionPortalImpl#createCamera (a webcam that is not in the SandBot robot configuration)");
            }
        }
        else if (cameraName.isCameraDirection()) // Internal cameras
        {
            // SandBot: 실제는 내장(폰) 카메라. Control Hub에는 없다
            throw new SimUnsupportedException("org.firstinspires.ftc.vision.VisionPortalImpl#createCamera (built-in phone camera)");
        }
        else if (cameraName.isSwitchable())
        {
            // SandBot: 실제는 OpenCvCameraFactory.createSwitchableWebcam(…)
            throw new SimUnsupportedException("org.firstinspires.ftc.vision.VisionPortalImpl#createCamera (switchable webcam)");
        }
        else // ¯\_(ツ)_/¯
        {
            throw new IllegalArgumentException("Unknown camera name");
        }
    }

    @Override
    public void setProcessorEnabled(VisionProcessor processor, boolean enabled)
    {
        int numProcessorsEnabled = 0;
        boolean ok = false;

        for (int i = 0; i < processors.length; i++)
        {
            if (processor == processors[i])
            {
                processorsEnabled[i] = enabled;
                ok = true;
            }

            if (processorsEnabled[i])
            {
                numProcessorsEnabled++;
            }
        }

        if (ok)
        {
            if (autoPauseCameraMonitor)
            {
                // SandBot: 실제는 camera.pauseViewport()·resumeViewport()(LiveView). 닫힌 포털은 camera가 null이라 실제처럼 NPE다
                if (sandbotCamera == null)
                {
                    throw new NullPointerException("Attempt to invoke interface method 'void org.openftc.easyopencv.OpenCvCamera."
                            + (numProcessorsEnabled == 0 ? "pauseViewport" : "resumeViewport") + "()' on a null object reference");
                }
            }
            sandbotPublish();
        }
        else
        {
            throw new IllegalArgumentException("Processor not attached to this helper!");
        }
    }

    @Override
    public boolean getProcessorEnabled(VisionProcessor processor)
    {
        for (int i = 0; i < processors.length; i++)
        {
            if (processor == processors[i])
            {
                return processorsEnabled[i];
            }
        }

        throw new IllegalArgumentException("Processor not attached to this helper!");
    }

    @Override
    public CameraState getCameraState()
    {
        return cameraState;
    }

    @Override
    public void setActiveCamera(WebcamName webcamName)
    {
        // SandBot: 실제는 camera instanceof OpenCvSwitchableWebcam이면 바꾼다. SandBot 웹캠은 스위처블이 아니다
        throw new UnsupportedOperationException("setActiveCamera is only supported for switchable webcams");
    }

    @Override
    public WebcamName getActiveCamera()
    {
        // SandBot: setActiveCamera와 같다
        throw new UnsupportedOperationException("getActiveCamera is only supported for switchable webcams");
    }

    @Override
    public <T extends CameraControl> T getCameraControl(Class<T> controlType)
    {
        if (cameraState == CameraState.STREAMING)
        {
            // SandBot: 실제는 ((OpenCvWebcam) camera).getControl(controlType). 웹캠마다 하나의 제어 객체(기록만, 영상에 영향 없음)
            return sandbotCamera.control(controlType);
        }
        else
        {
            throw new IllegalStateException("You cannot use camera controls until the camera is streaming");
        }
    }

    @Override
    public void getFrameBitmap(Continuation<? extends Consumer<Bitmap>> continuation)
    {
        // SandBot: 실제는 열린 카메라의 getFrameBitmap. 영상이 없어 아무것도 하지 않는다(팀 코드가 Continuation을 만드는 데서 먼저
        // SimUnsupportedException으로 멈춘다)
    }

    @Override
    public void saveNextFrameRaw(String filepath)
    {
        synchronized (captureFrameMtx)
        {
            captureNextFrame = filepath;
        }
        // SandBot: 실제는 다음 프레임을 /sdcard/VisionPortal-<이름>.png로 쓴다. 영상이 없다
        sandbotNotice("visionFrameCapture", "method", "saveNextFrameRaw");
    }

    @Override
    public void stopStreaming()
    {
        // SandBot: 실제는 userStateSemaphore.acquireUninterruptibly()(진행 중 전이를 기다림)
        sandbotAcquire();

        if (cameraState == CameraState.STREAMING || cameraState == CameraState.STARTING_STREAM)
        {
            cameraState = CameraState.STOPPING_STREAM;
            // SandBot: 실제는 새 스레드에서 camera.stopStreaming() 뒤 CAMERA_DEVICE_READY. 기다리던 프레임은 버리고 처리 중인 것은 끝낸다
            sandbotWaiting = null;
            sandbotBegin(SANDBOT_STOP, Sim.nanoTime() + SANDBOT_STOP_NANOS);
        }
        else if (cameraState == CameraState.STOPPING_STREAM
                || cameraState == CameraState.CAMERA_DEVICE_READY
                || cameraState == CameraState.CLOSING_CAMERA_DEVICE)
        {
            // NO-OP: be idempotent
        }
        else
        {
            throw new RuntimeException(String.format("Illegal CameraState %s when calling stopStreaming()", cameraState.toString()));
        }
        sandbotPublish();
    }

    @Override
    public void resumeStreaming()
    {
        // SandBot: 실제는 userStateSemaphore.acquireUninterruptibly()
        sandbotAcquire();

        if (cameraState == CameraState.CAMERA_DEVICE_READY || cameraState == CameraState.STOPPING_STREAM)
        {
            cameraState = CameraState.STARTING_STREAM;
            // SandBot: 실제는 새 스레드에서 ((OpenCvWebcam) camera).startStreaming(…, webcamStreamFormat.eocvStreamFormat). 형식이
            // null이면(Builder 기본) 그 줄에서 NullPointerException이 나 finally가 세마포어만 풀고 STARTING_STREAM에 머문다(실제 12.0)
            if (webcamStreamFormat == null)
            {
                sandbotNotice("visionResumeNullFormat", null, null);
            }
            else
            {
                long now = Sim.nanoTime();
                sandbotStreamStarting(now);
                sandbotBegin(SANDBOT_START, now + SANDBOT_START_NANOS);
            }
        }
        else if (cameraState == CameraState.STREAMING
                || cameraState == CameraState.STARTING_STREAM)
        {
            // NO-OP: be idempotent
        }
        else
        {
            throw new RuntimeException(String.format("Illegal CameraState %s when calling resumeStreaming()", cameraState.toString()));
        }
        sandbotPublish();
    }

    @Override
    public void stopLiveView()
    {
        // SandBot: 실제는 camera.pauseViewport()(LiveView). 화면이 없다
    }

    @Override
    public void resumeLiveView()
    {
        // SandBot: 실제는 camera.resumeViewport()(LiveView). 화면이 없다
    }

    @Override
    public float getFps()
    {
        // SandBot: 실제 camera != null 판정과 cameraSafe.getFps()
        if (sandbotCamera != null)
        {
           return sandbotFps;
        }
        else
        {
            return 0;
        }
    }

    @Override
    public void close()
    {
        // SandBot: 실제는 userStateSemaphore.acquireUninterruptibly()
        sandbotAcquire();

        try
        {
            if (sandbotCamera != null && cameraState != CameraState.CLOSING_CAMERA_DEVICE)
            {
                cameraState = CameraState.CLOSING_CAMERA_DEVICE;
                // SandBot: 실제는 새 스레드에서 camera.closeCameraDevice() 뒤 CAMERA_DEVICE_CLOSED, camera = null
                // SandBot: closeCameraDevice도 stopStreaming처럼 처리 중인 프레임을 끝낸 뒤 닫힘을 알리므로(spec-4d §1.10), 처리 중
                // 결과의 끝이 닫기 시간보다 늦으면 그때 닫힌다(대기 칸은 버린다)
                sandbotWaiting = null;
                long closeEnd = Sim.nanoTime() + SANDBOT_CLOSE_NANOS;
                if (sandbotInFlight != null && sandbotInFlight.end > closeEnd) closeEnd = sandbotInFlight.end;
                sandbotBegin(SANDBOT_CLOSE, closeEnd);
            }
        }
        finally
        {
            synchronized (viewUseMtx)
            {
                if (cameraMonitorViewId != 0 && viewsInUse.contains(cameraMonitorViewId))
                {
                    viewsInUse.remove(Integer.valueOf(cameraMonitorViewId));
                }
            }
        }
        sandbotPublish();
    }

    // SandBot: 가상 시간 상태 기계 ------------------------------------------------------------------------------------------

    /**
     * 진행 중 전이가 끝날 때까지 다음 틱을 기다린다(userStateSemaphore 대응). 끼어들기는 삼켰다가 돌아가기 전에 되살린다. 틱 경계의 일
     * 안(예: 팀이 등록한 OpMode 수명 리스너)이나 틱 밖에서는 다음 경계를 기다릴 수 없어 awaitNextTick이 시간을 보내지 않으므로, 그때는
     * 실제 세마포어처럼 전이가 끝날 때까지 시간을 보내고(charge) 그 자리에서 전이를 끝낸다(그러지 않으면 끝없이 돈다)
     */
    private void sandbotAcquire()
    {
        boolean interrupted = false;
        while (sandbotTransition != SANDBOT_NONE)
        {
            long before = Sim.nanoTime();
            try
            {
                Sim.clock().awaitNextTick();
            }
            catch (InterruptedException e)
            {
                interrupted = true;
                continue;
            }
            long now = Sim.nanoTime();
            if (sandbotTransition != SANDBOT_NONE && now == before)
            {
                if (sandbotTransitionEnd > now) Sim.clock().charge(sandbotTransitionEnd - now);
                sandbotApplyTransitions(Math.max(sandbotTransitionEnd, now));
            }
        }
        if (interrupted)
        {
            Thread.currentThread().interrupt();
        }
    }

    private void sandbotBegin(int transition, long end)
    {
        sandbotTransition = transition;
        sandbotTransitionEnd = end;
    }

    /** EOCV prepareForStartStreaming(OpenCvCameraBase.java:171–177): FPS 표본과 타이머를 새로 만든다 */
    private void sandbotStreamStarting(long nanos)
    {
        sandbotIntervals = new MovingStatistics(SANDBOT_FPS_SAMPLES);
        sandbotLastStartNanos = nanos;
    }

    /** 틱 경계 b(OpMode 스레드, 시계 호출 안): 끝난 전이 → 끝난 처리의 결과 → 새 프레임. 시계를 부르지 않는다 */
    private void sandbotBoundary(long b)
    {
        sandbotApplyTransitions(b);
        sandbotDeliver(b);
        if (sandbotCamera != null && !sandbotOpenFailed && sandbotCamera.frameNanos() > sandbotLastFrameNanos)
        {
            SimCameraFrame frame = sandbotCamera.frame();
            if (frame != null)
            {
                sandbotLastFrameNanos = frame.frameNanos;
                if (cameraState == CameraState.STREAMING)
                {
                    if (sandbotInFlight != null)
                    {
                        sandbotWaiting = frame;
                    }
                    else
                    {
                        sandbotStartProcessing(frame, frame.frameNanos);
                        sandbotDeliver(b);
                    }
                }
            }
        }
        sandbotPublish();
    }

    /** 끝 시각이 b 이하인 전이를 끝낸다(경계 듣기, 또는 기다릴 수 없는 sandbotAcquire). 시계를 부르지 않는다 */
    private void sandbotApplyTransitions(long b)
    {
        while (sandbotTransition != SANDBOT_NONE && sandbotTransitionEnd <= b)
        {
            int kind = sandbotTransition;
            long end = sandbotTransitionEnd;
            sandbotTransition = SANDBOT_NONE;
            if (kind == SANDBOT_OPEN)
            {
                if (sandbotOpenFailed)
                {
                    // 실제 onError
                    cameraState = CameraState.ERROR;
                    RobotLog.ee("VisionPortalImpl", "Camera opening failed.");
                }
                else
                {
                    // 실제 onOpened: READY → 보정 조회 → autoStart면 같은 콜백 안에서 STARTING_STREAM(경계에서 READY는 보이지 않는다)
                    cameraState = CameraState.CAMERA_DEVICE_READY;
                    CameraCalibrationIdentity identity = SandbotCameraModels.identity(sandbotCamera.model());
                    if (identity != null)
                    {
                        calibration = SandbotCameraCalibrations.getCalibration(identity, cameraResolution.getWidth(), cameraResolution.getHeight());
                    }
                    if (autoStartStream)
                    {
                        cameraState = CameraState.STARTING_STREAM;
                        sandbotStreamStarting(end);
                        sandbotBegin(SANDBOT_START, end + SANDBOT_START_NANOS);
                    }
                }
            }
            else if (kind == SANDBOT_START)
            {
                cameraState = CameraState.STREAMING;
            }
            else if (kind == SANDBOT_STOP)
            {
                cameraState = CameraState.CAMERA_DEVICE_READY;
            }
            else if (kind == SANDBOT_CLOSE)
            {
                // SandBot: 처리 중이던 프레임의 결과(또는 예외)를 닫힘보다 먼저 낸다. 경계 듣기를 떼면 sandbotDeliver가 다시 불리지 않고,
                // 기다릴 수 없는 sandbotAcquire 경로는 sandbotDeliver를 부르지 않는다(끝 시각은 close가 처리 끝 이후로 잡았다)
                sandbotDeliver(end);
                cameraState = CameraState.CAMERA_DEVICE_CLOSED;
                sandbotCamera.release(this);
                sandbotCamera = null;
                sandbotWaiting = null;
                Sim.removeBoundaryListener(sandbotListener);
            }
        }
    }

    /** 끝 시각이 b 이하인 처리의 결과를 내고, 기다리는 프레임이 있으면 그 끝 시각에 바로 처리를 시작한다 */
    @SuppressWarnings("unchecked")
    private void sandbotDeliver(long b)
    {
        while (sandbotInFlight != null && sandbotInFlight.end <= b)
        {
            SandbotWork work = sandbotInFlight;
            sandbotInFlight = null;
            if (work.error != null)
            {
                // 실제는 카메라 스레드의 예외가 EOCV handleFrame → emulateEStop(OpMode 정지)이다. 그 프레임의 검출은 바뀌지 않는다.
                // 자세 풀이 안내는 OpenCV 예외일 때만(다른 예외도 실제처럼 OpMode를 멈춘다)
                if (work.error instanceof CvException) sandbotNotice("visionSolverStop", "solver", work.errorSolver);
                Sim.host().emergencyStop(work.error);
            }
            else
            {
                for (int i = 0; i < processors.length; i++)
                {
                    if (work.results[i] != null)
                    {
                        SandbotAprilTagFrames.publish(processors[i], (ArrayList<AprilTagDetection>) work.results[i]);
                    }
                }
            }
            if (sandbotWaiting != null)
            {
                SimCameraFrame next = sandbotWaiting;
                sandbotWaiting = null;
                sandbotStartProcessing(next, work.end);
            }
        }
    }

    /** 프레임 처리 시작(시각 s): FPS 표본, 처음이면 처리기 init, 켜진 AprilTag 처리기마다 검출, 처리 시간 뒤 결과 */
    private void sandbotStartProcessing(SimCameraFrame frame, long s)
    {
        // EOCV handleFrameUserCrashable(OpenCvCameraBase.java:513–518): 지난 시작부터의 간격(ms) 30개 평균
        sandbotIntervals.add((s - sandbotLastStartNanos) / 1e6);
        sandbotLastStartNanos = s;
        double secondsPerFrame = sandbotIntervals.getMean() / 1000d;
        sandbotFps = (float) (1d / secondsPerFrame);

        int width = frame.width > 0 ? frame.width : cameraResolution.getWidth();
        int height = frame.height > 0 ? frame.height : cameraResolution.getHeight();
        if (!sandbotProcessorsInitialized)
        {
            // 실제 ProcessingPipeline.init(첫 프레임, 포털 수명에 한 번). SandBot은 AprilTag 처리기만 부른다
            sandbotProcessorsInitialized = true;
            for (VisionProcessor processor : processors)
            {
                if (SandbotAprilTagFrames.isAprilTag(processor))
                {
                    processor.init(width, height, calibration);
                }
            }
        }

        ArrayList<?>[] results = new ArrayList<?>[processors.length];
        RuntimeException error = null;
        String errorSolver = null;
        Object first = null;
        for (int i = 0; i < processors.length; i++)
        {
            if (!processorsEnabled[i] || !SandbotAprilTagFrames.isAprilTag(processors[i])) continue;
            if (first == null) first = processors[i];
            try
            {
                results[i] = SandbotAprilTagFrames.process(processors[i], frame);
            }
            catch (RuntimeException e)
            {
                error = e;
                errorSolver = SandbotAprilTagFrames.poseSolver(processors[i]);
                break;
            }
        }
        long processing = first == null ? 0 : sandbotProcessingNanos(SandbotAprilTagFrames.appliedDecimation(first), width, height);
        sandbotInFlight = new SandbotWork(s + processing, results, error, errorSolver);
    }

    /**
     * 처리 시간 [가정: 처리 시간 표]: 640×480 기준 데시메이션 1·2·3에서 100·45·22 ms(d 3은 실물 DS 화면 "Pipeline: 19ms · Overhead:
     * 3ms", d 1·2는 샘플 주석 FPS), 그 사이는 직선, 1 아래·3 위는 끝 값, 픽셀 수에 비례
     */
    static long sandbotProcessingNanos(float decimation, int width, int height)
    {
        double d = decimation;
        double ms;
        if (d <= 1) ms = 100;
        else if (d <= 2) ms = 100 + (45 - 100) * (d - 1);
        else if (d < 3) ms = 45 + (22 - 45) * (d - 2);
        else ms = 22;
        return StrictMath.round(ms * 1e6 * ((double) width * height) / (640.0 * 480.0));
    }

    /** 웹캠 출력(spec-4d §1.10): 잡은 포털만 쓴다 */
    private void sandbotPublish()
    {
        SimCamera cam = sandbotCamera;
        if (cam == null) return;
        Object first = null;
        int aprilTags = 0;
        for (int i = 0; i < processors.length; i++)
        {
            if (processorsEnabled[i] && SandbotAprilTagFrames.isAprilTag(processors[i]))
            {
                if (first == null) first = processors[i];
                aprilTags++;
            }
        }
        if (aprilTags > 1 && !sandbotMultipleNotified)
        {
            sandbotMultipleNotified = true;
            sandbotNotice("visionMultipleAprilTag", null, null);
        }
        cam.publish(this, cameraState.name(), cameraState == CameraState.STREAMING, cameraResolution.getWidth(),
                cameraResolution.getHeight(), first != null, first != null ? SandbotAprilTagFrames.family(first) : null,
                first != null ? Double.valueOf(SandbotAprilTagFrames.pendingDecimation(first)) : null, sandbotFps);
    }

    private static void sandbotNotice(String code, String key, String value)
    {
        Map<String, String> params = key == null ? Collections.<String, String>emptyMap() : new TreeMap<String, String>();
        if (key != null) params.put(key, value);
        if (Sim.installed()) Sim.host().notice(code, params);
    }
}
