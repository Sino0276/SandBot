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
// SandBot: 실제 12.0 소스에서 출발했다(spec-4d §1.9·§1.11). 영상·apriltag JNI가 없어 검출은 시뮬레이터의 원시 검출(id·꼭짓점,
// SimCameraFrame)에서 만들고(포털이 SandbotAprilTagFrames로 부른다), 자세 풀이는 OpenCV 4.10.0 solvePnP를 옮긴
// org.sandbot.sdk.vision.Pnp다(Mat·MatOfPoint*·Calib3d 대신 float 배열, 실제처럼 float로 자른다). 그 밖(Builder 기본값, init의
// 렌즈 값 대체 순서와 경고 문구, 묶음·단일 풀이, ftcPose·robotPose 계산, getDetections·getFreshDetections)은 실제 그대로다.
// 바꾼 줄은 모두 "// SandBot:"이다. 옮긴 SDK 줄의 Math는 실제 그대로다(spec-4d §0).
package org.firstinspires.ftc.vision.apriltag;

import android.graphics.Canvas;
import android.util.Log;

import com.qualcomm.robotcore.util.MovingStatistics;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.matrices.GeneralMatrixF;
import org.firstinspires.ftc.robotcore.external.matrices.OpenGLMatrix;
import org.firstinspires.ftc.robotcore.external.matrices.VectorF;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose3D;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.firstinspires.ftc.robotcore.external.navigation.Position;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibration;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.PlaceholderCalibratedAspectRatioMismatch;
import org.opencv.core.Mat;
import org.opencv.core.Point;
import org.opencv.core.Point3;
import org.sandbot.sdk.devices.SandbotCameraCalibrations;
import org.sandbot.sdk.devices.SimCameraFrame;
import org.sandbot.sdk.vision.Pnp;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimUnsupportedException;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;

public class AprilTagProcessorImpl extends AprilTagProcessor
{
    public static final String TAG = "AprilTagProcessorImpl";

    private long nativeApriltagPtr;
    // SandBot: 실제는 new Mat()(회색 영상). stub Mat 생성자는 SimUnsupportedException이고 영상이 없다
    private Mat grey = null;
    private ArrayList<AprilTagDetection> detections = new ArrayList<>();

    private ArrayList<AprilTagDetection> detectionsUpdate = new ArrayList<>();
    private final Object detectionsUpdateSync = new Object();
    private boolean drawAxes;
    private boolean drawCube;
    private boolean drawOutline;
    private boolean drawTagID;

    // SandBot: 실제는 CV_32FC1 Mat. fx·fy·cx·cy를 float로 자른 값(constructMatrix)
    private float[] cameraMatrix;

    private double fx;
    private double fy;
    private double cx;
    private double cy;
    private final boolean suppressCalibrationWarnings;

    private final AprilTagLibrary tagLibrary;

    private float decimation;
    private boolean needToSetDecimation;
    private final Object decimationSync = new Object();

    // SandBot: 실제 AprilTagCanvasAnnotator(stub)는 만들지 않는다(그릴 영상이 없다)

    private final DistanceUnit outputUnitsLength;
    private final AngleUnit outputUnitsAngle;

    private volatile PoseSolver poseSolver = PoseSolver.OPENCV_ITERATIVE;

    private OpenGLMatrix robotInCameraFrame;

    // SandBot: 시뮬레이터 상태 — 패밀리, 검출기가 지금 쓰는 데시메이션(실제 createApriltagDetector의 기본 3), 포털에 알릴 것,
    // 이미 알린 안내
    private final TagFamily sandbotFamily;
    private float sandbotAppliedDecimation = 3;
    private Runnable sandbotChanged;
    private final Set<String> sandbotNotified = new LinkedHashSet<>();

    public AprilTagProcessorImpl(OpenGLMatrix robotInCameraFrame, double fx, double fy, double cx, double cy, DistanceUnit outputUnitsLength, AngleUnit outputUnitsAngle, AprilTagLibrary tagLibrary,
                                 boolean drawAxes, boolean drawCube, boolean drawOutline, boolean drawTagID, TagFamily tagFamily, int threads, boolean suppressCalibrationWarnings)
    {
        this.robotInCameraFrame = robotInCameraFrame;

        this.fx = fx;
        this.fy = fy;
        this.cx = cx;
        this.cy = cy;

        this.tagLibrary = tagLibrary;
        this.outputUnitsLength = outputUnitsLength;
        this.outputUnitsAngle = outputUnitsAngle;
        this.suppressCalibrationWarnings = suppressCalibrationWarnings;
        this.drawAxes = drawAxes;
        this.drawCube = drawCube;
        this.drawOutline = drawOutline;
        this.drawTagID = drawTagID;

        // SandBot: 실제는 AprilTagDetectorJNI.createApriltagDetector(tagFamily.ATLibTF.string, 3, threads)(네이티브 검출기)
        this.sandbotFamily = tagFamily;
        nativeApriltagPtr = 0;
    }

    @Override
    protected void finalize()
    {
        // SandBot: 실제는 네이티브 검출기를 놓거나 nativeApriltagPtr가 0이면 System.out에 한 줄을 쓴다. SandBot은 늘 0이라 GC 시각에
        // Finalizer 스레드가 로그를 내 출력이 GC에 따라 달라지므로(결정성) 본문을 비운다
    }

    @Override
    public void init(int width, int height, CameraCalibration calibration)
    {
        // ATTEMPT 1 - If the user provided their own calibration, use that
        if (fx != 0 && fy != 0 && cx != 0 && cy != 0)
        {
            Log.d(TAG, String.format("User provided their own camera calibration fx=%7.3f fy=%7.3f cx=%7.3f cy=%7.3f",
                    fx, fy, cx, cy));
        }

        // ATTEMPT 2 - If we have valid calibration we can use, use it
        else if (calibration != null && !calibration.isDegenerate()) // needed because we may get an all zero calibration to indicate none, instead of null
        {
            fx = calibration.focalLengthX;
            fy = calibration.focalLengthY;
            cx = calibration.principalPointX;
            cy = calibration.principalPointY;

            // Note that this might have been a scaled calibration - inform the user if so
            if (calibration.resolutionScaledFrom != null)
            {
                String msg = String.format("Camera has not been calibrated for [%dx%d]; applying a scaled calibration from [%dx%d].", width, height, calibration.resolutionScaledFrom.getWidth(), calibration.resolutionScaledFrom.getHeight());

                Log.d(TAG, msg);

                if (!suppressCalibrationWarnings)
                {
                    RobotLog.addGlobalWarningMessage(msg);
                }
            }
            // Nope, it was a full up proper calibration - no need to pester the user about anything
            else
            {
                Log.d(TAG, String.format("User did not provide a camera calibration; but we DO have a built in calibration we can use.\n [%dx%d] (NOT scaled) %s\nfx=%7.3f fy=%7.3f cx=%7.3f cy=%7.3f",
                        calibration.getSize().getWidth(), calibration.getSize().getHeight(), calibration.getIdentity().toString(), fx, fy, cx, cy));
            }
        }

        // Okay, we aren't going to have any calibration data we can use, but there are 2 cases to check
        else
        {
            // If we have a calibration on file, but with a wrong aspect ratio,
            // we can't use it, but hey at least we can let the user know about it.
            if (calibration instanceof PlaceholderCalibratedAspectRatioMismatch)
            {
                StringBuilder supportedResBuilder = new StringBuilder();

                // SandBot: 실제는 CameraCalibrationHelper.getInstance().getCalibrations(…)(안드로이드 자원, stub). 같은 규칙의 조회
                for (CameraCalibration cal : SandbotCameraCalibrations.calibrationsFor(calibration.getIdentity()))
                {
                    supportedResBuilder.append(String.format("[%dx%d],", cal.getSize().getWidth(), cal.getSize().getHeight()));
                }

                String msg = String.format("Camera has not been calibrated for [%dx%d]. Pose estimates will likely be inaccurate. However, there are built in calibrations for resolutions: %s",
                        width, height, supportedResBuilder.toString());

                Log.d(TAG, msg);

                if (!suppressCalibrationWarnings)
                {
                    RobotLog.addGlobalWarningMessage(msg);
                }
            }

            // Nah, we got absolutely nothing
            else
            {
                String warning = "User did not provide a camera calibration, nor was a built-in calibration found for this camera. Pose estimates will likely be inaccurate.";
                Log.d(TAG, warning);

                if (!suppressCalibrationWarnings)
                {
                    RobotLog.addGlobalWarningMessage(warning);
                }
            }

            // IN EITHER CASE, set it to *something* so we don't crash the native code
            fx = 578.272;
            fy = 578.272;
            cx = width/2;
            cy = height/2;
        }

        constructMatrix();
        // SandBot: 실제는 canvasAnnotator = new AprilTagCanvasAnnotator(cameraMatrix)(stub, 그릴 영상이 없다)
    }

    @Override
    public Object processFrame(Mat input, long captureTimeNanos)
    {
        // SandBot: 영상이 없다. 포털은 SandbotAprilTagFrames.process로 원시 검출을 넘긴다
        throw new SimUnsupportedException("org.firstinspires.ftc.vision.apriltag.AprilTagProcessorImpl#processFrame(org.opencv.core.Mat,long)");
    }

    // SandBot: 실제 processFrame의 데시메이션 적용 → runAprilTagDetectorForMultipleTagSizes에 해당(SandbotAprilTagFrames가 부른다).
    // 결과는 포털이 결과 시각에 sandbotPublish로 넣는다(실제 카메라 스레드가 detections를 바꾸는 때의 가상 대응, spec-4d §1.10)
    ArrayList<AprilTagDetection> sandbotProcess(SimCameraFrame frame)
    {
        synchronized (decimationSync)
        {
            if(needToSetDecimation)
            {
                sandbotAppliedDecimation = decimation;
                needToSetDecimation = false;
            }
        }
        return runAprilTagDetectorForMultipleTagSizes(frame, frame.frameNanos);
    }

    void sandbotPublish(ArrayList<AprilTagDetection> result)
    {
        detections = result;

        synchronized (detectionsUpdateSync)
        {
            detectionsUpdate = detections;
        }
    }

    TagFamily sandbotFamily()
    {
        return sandbotFamily;
    }

    float sandbotNextDecimation()
    {
        synchronized (decimationSync)
        {
            return needToSetDecimation ? decimation : sandbotAppliedDecimation;
        }
    }

    float sandbotAppliedDecimation()
    {
        synchronized (decimationSync)
        {
            return sandbotAppliedDecimation;
        }
    }

    PoseSolver sandbotPoseSolver()
    {
        return poseSolver;
    }

    void sandbotSetChangeListener(Runnable listener)
    {
        sandbotChanged = listener;
    }

    private void sandbotNotice(String code, String key, String value)
    {
        if (!sandbotNotified.add(code + "\0" + value)) return;
        java.util.Map<String, String> params = new java.util.TreeMap<>();
        if (key != null) params.put(key, value);
        if (Sim.installed()) Sim.host().notice(code, params);
    }

    private AprilTagPoseRaw doClusterSolve(TagClusterNotebook n, PoseSolver solver)
    {
        final int CORNERS_PER_TAG = 4;

        Point[] imagePts = new Point[n.detections.size() * CORNERS_PER_TAG];
        Point3[] idealProjectionPts = new Point3[imagePts.length];

        for (int tag = 0; tag < n.detections.size(); tag++)
        {
            PreliminaryTagDetection det = n.detections.get(tag);
            AprilTagClusterMemberMetadata metadata = n.cluster.getMemberMetadata(det.id);

            double tagsize = outputUnitsLength.fromUnit(n.cluster.distanceUnit, metadata.tagsize);
            double offsetX = outputUnitsLength.fromUnit(n.cluster.distanceUnit, metadata.positionInClusterPlane.get(0));
            double offsetY = outputUnitsLength.fromUnit(n.cluster.distanceUnit, metadata.positionInClusterPlane.get(1));
            double offsetZ = outputUnitsLength.fromUnit(n.cluster.distanceUnit, metadata.positionInClusterPlane.get(2));

            imagePts[tag * CORNERS_PER_TAG    ] = det.corners[0];
            imagePts[tag * CORNERS_PER_TAG + 1] = det.corners[1];
            imagePts[tag * CORNERS_PER_TAG + 2] = det.corners[2];
            imagePts[tag * CORNERS_PER_TAG + 3] = det.corners[3];

            idealProjectionPts[tag * CORNERS_PER_TAG    ] = new Point3(-tagsize/2 + offsetX,  tagsize/2 + offsetY, offsetZ);
            idealProjectionPts[tag * CORNERS_PER_TAG + 1] = new Point3( tagsize/2 + offsetX,  tagsize/2 + offsetY, offsetZ);
            idealProjectionPts[tag * CORNERS_PER_TAG + 2] = new Point3( tagsize/2 + offsetX, -tagsize/2 + offsetY, offsetZ);
            idealProjectionPts[tag * CORNERS_PER_TAG + 3] = new Point3(-tagsize/2 + offsetX, -tagsize/2 + offsetY, offsetZ);
        }

        // SandBot: 실제는 solver.code를 그대로 넘긴다. SQPNP는 Pnp가 ITERATIVE로 대신하므로 처음 쓸 때 알린다
        // (APRILTAG_BUILTIN(-1)은 실제 OpenCV처럼 StsBadArg 예외다)
        if (solver == PoseSolver.OPENCV_SQPNP) sandbotNotice("visionSolverSubstituted", "solver", solver.name());
        Pose opencvPose = poseFromNGrt4Pts(imagePts, idealProjectionPts, cameraMatrix, solver.code);

        // Build rotation matrix
        // SandBot: 실제는 Calib3d.Rodrigues(rvec, R CV_32F) → R.get(0,0,tmp2)(float)
        float[] tmp2 = Pnp.rodrigues(opencvPose.rvec);

        return new AprilTagPoseRaw(
                opencvPose.tvec[0], // x
                opencvPose.tvec[1], // y
                opencvPose.tvec[2], // z
                new GeneralMatrixF(3,3, tmp2)); // R
    }

    private MovingStatistics solveTime = new MovingStatistics(50);

    private AprilTagPoseRaw doSingleTagPoseSolve(AprilTagMetadata metadata, PoseSolver solver, Point[] cornerPts)
    {
        AprilTagPoseRaw rawPose;

        // SandBot: 실제는 System.currentTimeMillis() 차를 solveTime에 넣는다(벽시계). 결정성을 위해 0 ms
        // [가정: 단일 태그 풀이 시간 0 ms — Control Hub에서 4점 solvePnP는 1 ms 아래라 정수 ms 평균이 0에 가깝다]

        int code = solver.code;
        if (solver == PoseSolver.APRILTAG_BUILTIN)
        {
            // SandBot: 실제는 ApriltagDetectionJNI.getPoseEstimate(네이티브 apriltag 풀이). ITERATIVE로 대신한다
            // [가정: 대체 solver, spec-4d §1.12]
            sandbotNotice("visionSolverSubstituted", "solver", solver.name());
            code = PoseSolver.OPENCV_ITERATIVE.code;
        }
        else if (solver == PoseSolver.OPENCV_SQPNP)
        {
            sandbotNotice("visionSolverSubstituted", "solver", solver.name());
        }

        {
            Pose opencvPose = poseFromTrapezoid(
                    cornerPts,
                    cameraMatrix,
                    outputUnitsLength.fromUnit(metadata.distanceUnit, metadata.tagsize),
                    code);

            // Build rotation matrix
            float[] tmp2 = Pnp.rodrigues(opencvPose.rvec);

            rawPose = new AprilTagPoseRaw(
                    opencvPose.tvec[0], // x
                    opencvPose.tvec[1], // y
                    opencvPose.tvec[2], // z
                    new GeneralMatrixF(3,3, tmp2)); // R
        }

        solveTime.add(0);

        return rawPose;
    }

    private AprilTagPoseFtc rawPoseToFtcPose(AprilTagPoseRaw rawPose)
    {
        Orientation rot = Orientation.getOrientation(rawPose.R, AxesReference.INTRINSIC, AxesOrder.YXZ, outputUnitsAngle);

        return new AprilTagPoseFtc(
                rawPose.x,  // x   NB: These are *intentionally* not matched directly;
                rawPose.z,  // y       this is the mapping between the AprilTag coordinate
                -rawPose.y, // z       system and the FTC coordinate system
                -rot.firstAngle, // yaw
                rot.secondAngle, // pitch
                rot.thirdAngle,  // roll
                Math.hypot(rawPose.x, rawPose.z), // range
                outputUnitsAngle.fromUnit(AngleUnit.RADIANS, Math.atan2(-rawPose.x, rawPose.z)), // bearing
                outputUnitsAngle.fromUnit(AngleUnit.RADIANS, Math.atan2(-rawPose.y, rawPose.z))); // elevation
    }

    // SandBot: 실제 getPreliminaryDetectionFromNative(ApriltagDetectionJNI). 원시 검출의 꼭짓점(apriltag 3 픽셀 좌표)에서 만든다.
    // 중심은 apriltag의 homography_project(H, 0, 0)(apriltag.c:994) = 네 꼭짓점의 대각선 교점(꼭짓점 평균이 아니다)
    private PreliminaryTagDetection preliminaryDetectionFromFrame(SimCameraFrame frame, int tag)
    {
        Point[] cornerPts = new Point[4];
        for (int p = 0; p < 4; p++)
        {
            cornerPts[p] = new Point(frame.corner(tag, p, 0), frame.corner(tag, p, 1));
        }
        return new PreliminaryTagDetection(frame.id(tag), diagonalIntersection(cornerPts), cornerPts);
    }

    // SandBot: 두 대각선 c0–c2, c1–c3의 교점(새 코드라 StrictMath를 쓸 곳이 없는 사칙연산)
    private static Point diagonalIntersection(Point[] c)
    {
        double d1x = c[2].x - c[0].x, d1y = c[2].y - c[0].y;
        double d2x = c[3].x - c[1].x, d2y = c[3].y - c[1].y;
        double den = d1x * d2y - d1y * d2x;
        if (den == 0)
        {
            return new Point((c[0].x + c[1].x + c[2].x + c[3].x) / 4, (c[0].y + c[1].y + c[2].y + c[3].y) / 4);
        }
        double s = ((c[1].x - c[0].x) * d2y - (c[1].y - c[0].y) * d2x) / den;
        return new Point(c[0].x + s * d1x, c[0].y + s * d1y);
    }

    private PreliminaryFrameFindings segmentFrameFindings(SimCameraFrame frame)
    {
        PreliminaryFrameFindings findings = new PreliminaryFrameFindings();

        for (int tag = 0; tag < frame.tagCount(); tag++)
        {
            PreliminaryTagDetection prelimDet = preliminaryDetectionFromFrame(frame, tag);

            // if we come back with a cluster match then this goes into a cluster notebook
            AprilTagClusterMetadata cluster = tagLibrary.lookupCluster(prelimDet.id);
            if (cluster != null)
            {
                findings.noteClusterTag(prelimDet, cluster);
            }
            // if no cluster match then this is just a single tag
            else
            {
                findings.noteSingleTag(prelimDet);
            }
        }

        return findings;
    }

    ArrayList<AprilTagDetection> runAprilTagDetectorForMultipleTagSizes(SimCameraFrame frame, long captureTimeNanos)
    {
        // SandBot: 실제는 AprilTagDetectorJNI.runApriltagDetector(영상). 검출이 없으면 실제처럼 새 빈 목록
        if (frame.tagCount() == 0)
        {
            // native code gave null pointer, nothing we can do here
            // note native code will return null if there was nothing for
            // it to put into the list
            return new ArrayList<>();
        }

        ArrayList<AprilTagDetection> detections = new ArrayList<>(frame.tagCount());

        PreliminaryFrameFindings prelimFindings = segmentFrameFindings(frame);

        // Process tag clusters
        for (TagClusterNotebook n : prelimFindings.clusterNotebooks)
        {
            AprilTagPoseRaw rawPose;
            AprilTagPoseFtc ftcPose;
            Pose3D robotPose;

            rawPose = doClusterSolve(n, poseSolver);
            ftcPose = rawPoseToFtcPose(rawPose);
            robotPose = computeRobotPose(rawPose, n.cluster.fieldPosition, n.cluster.fieldOrientation, captureTimeNanos);

            int percentClusterFound = Math.round(((float)n.detections.size() / n.cluster.clusterMembers.size()) * 100);

            // SandBot: SDK BIOBUZZ 라이브러리의 묶음은 필드 자세가 없다(robotPose가 묶음 기준) — 묶음마다 한 번 알린다(spec-4d §1.6)
            if (sandbotNoFieldPose(n.cluster))
            {
                sandbotNotice("aprilTagNoFieldPose", "cluster", n.cluster.name);
            }

            detections.add(new AprilTagClusterDetection(
                    percentClusterFound, n.cluster, outputUnitsLength, ftcPose, rawPose, robotPose, captureTimeNanos)
            );
        }

        // Process single tags
        for (PreliminaryTagDetection det : prelimFindings.singleTags)
        {
            AprilTagMetadata metadata = tagLibrary.lookupTag(det.id);

            AprilTagPoseRaw rawPose;
            AprilTagPoseFtc ftcPose;
            Pose3D robotPose;

            if (metadata != null)
            {
                // note that poseSolver changes are not synchronized with anything so
                // it can change at any time, however we are effectively snapshotting
                // it when we pass it as an argument here
                rawPose = doSingleTagPoseSolve(metadata, poseSolver, det.corners);

                ftcPose = rawPoseToFtcPose(rawPose);
                robotPose = computeRobotPose(rawPose, metadata.fieldPosition, metadata.fieldOrientation, captureTimeNanos);
            }
            else
            {
                // We don't know anything about the tag size so we can't solve the pose
                rawPose = null;
                ftcPose = null;
                robotPose = null;
            }

            // SandBot: 실제는 ApriltagDetectionJNI.getHamming·getDecisionMargin. 원시 검출은 해밍 0이고 decisionMargin은
            // (float) min(100, 2·짧은 변 px)이다 [가정: decisionMargin 식, spec-4d §0]
            detections.add(new AprilTagSingleDetection(
                    det.id,
                    0,
                    (float) Math.min(100, 2 * shortSide(det.corners)),
                    det.center, det.corners, metadata, ftcPose, rawPose, robotPose, captureTimeNanos, outputUnitsLength));
        }

        return detections;
    }

    // SandBot: 사각형의 가장 짧은 변(px)
    private static double shortSide(Point[] c)
    {
        double min = Double.POSITIVE_INFINITY;
        for (int i = 0; i < 4; i++)
        {
            Point a = c[i], b = c[(i + 1) % 4];
            min = Math.min(min, StrictMath.hypot(b.x - a.x, b.y - a.y));
        }
        return min;
    }

    // SandBot: 묶음 metadata의 필드 위치가 (0,0,0)이고 방향이 단위 사원수인가(SDK getBioBuzzTagLibrary의 묶음)
    private static boolean sandbotNoFieldPose(AprilTagClusterMetadata cluster)
    {
        VectorF p = cluster.fieldPosition;
        Quaternion q = cluster.fieldOrientation;
        boolean zero = p == null || (p.get(0) == 0 && p.get(1) == 0 && p.get(2) == 0);
        boolean identity = q == null || (Math.abs(q.w) == 1 && q.x == 0 && q.y == 0 && q.z == 0);
        return zero && identity;
    }

    private Pose3D computeRobotPose(AprilTagPoseRaw rawPose, VectorF fieldPosition, Quaternion fieldOrientation, long acquisitionTime)
    {
        // Compute transformation matrix of tag pose in field reference frame
        float tagInFieldX = fieldPosition.get(0);
        float tagInFieldY = fieldPosition.get(1);
        float tagInFieldZ = fieldPosition.get(2);
        OpenGLMatrix tagInFieldR = new OpenGLMatrix(fieldOrientation.toMatrix());
        OpenGLMatrix tagInFieldFrame = OpenGLMatrix.identityMatrix()
                .translated(tagInFieldX, tagInFieldY, tagInFieldZ)
                .multiplied(tagInFieldR);

        // Compute transformation matrix of camera pose in tag reference frame
        float tagInCameraX = (float) DistanceUnit.INCH.fromUnit(outputUnitsLength, rawPose.x);
        float tagInCameraY = (float) DistanceUnit.INCH.fromUnit(outputUnitsLength, rawPose.y);
        float tagInCameraZ = (float) DistanceUnit.INCH.fromUnit(outputUnitsLength, rawPose.z);
        OpenGLMatrix tagInCameraR = new OpenGLMatrix((rawPose.R));
        OpenGLMatrix cameraInTagFrame = OpenGLMatrix.identityMatrix()
                .translated(tagInCameraX, tagInCameraY, tagInCameraZ)
                .multiplied(tagInCameraR)
                .inverted();

        // Compute transformation matrix of robot pose in field frame
        OpenGLMatrix robotInFieldFrame =
                tagInFieldFrame
                .multiplied(cameraInTagFrame)
                .multiplied(robotInCameraFrame);

        // Extract robot location
        VectorF robotInFieldTranslation = robotInFieldFrame.getTranslation();
        Position robotPosition = new Position(DistanceUnit.INCH,
                robotInFieldTranslation.get(0),
                robotInFieldTranslation.get(1),
                robotInFieldTranslation.get(2),
                acquisitionTime).toUnit(outputUnitsLength);

        // Extract robot orientation
        Orientation robotInFieldOrientation = Orientation.getOrientation(robotInFieldFrame,
                AxesReference.INTRINSIC, AxesOrder.ZXY, outputUnitsAngle);
        YawPitchRollAngles robotOrientation = new YawPitchRollAngles(outputUnitsAngle,
                robotInFieldOrientation.firstAngle,
                robotInFieldOrientation.secondAngle,
                robotInFieldOrientation.thirdAngle,
                acquisitionTime);

        return new Pose3D(robotPosition, robotOrientation);
    }

    private final Object drawSync = new Object();

    @Override
    public void onDrawFrame(Canvas canvas, int onscreenWidth, int onscreenHeight, float scaleBmpPxToCanvasPx, float scaleCanvasDensity, Object userContext)
    {
        // SandBot: 실제는 AprilTagCanvasAnnotator로 태그 윤곽·축을 그린다. 그릴 영상이 없다
        synchronized (drawSync)
        {
        }
    }

    public void setDecimation(float decimation)
    {
        synchronized (decimationSync)
        {
            this.decimation = decimation;
            needToSetDecimation = true;
        }
        // SandBot: 웹캠 출력 decimation(다음 프레임에 쓸 값)을 바로 다시 쓴다
        Runnable changed = sandbotChanged;
        if (changed != null) changed.run();
    }

    @Override
    public void setPoseSolver(PoseSolver poseSolver)
    {
        this.poseSolver = poseSolver;
    }

    @Override
    public int getPerTagAvgPoseSolveTime()
    {
        return (int) Math.round(solveTime.getMean());
    }

    public ArrayList<AprilTagDetection> getDetections()
    {
        return detections;
    }

    public ArrayList<AprilTagDetection> getFreshDetections()
    {
        synchronized (detectionsUpdateSync)
        {
            ArrayList<AprilTagDetection> ret = detectionsUpdate;
            detectionsUpdate = null;
            return ret;
        }
    }

    void constructMatrix()
    {
        //     Construct the camera matrix.
        //
        //      --         --
        //     | fx   0   cx |
        //     | 0    fy  cy |
        //     | 0    0   1  |
        //      --         --
        //

        // SandBot: 실제는 CV_32FC1 Mat에 put(double → float). 같은 float 값
        cameraMatrix = new float[] {(float) fx, (float) fy, (float) cx, (float) cy};
    }

    /**
     * Extracts 6DOF pose from a trapezoid, using a camera intrinsics matrix and the
     * original size of the tag.
     *
     * @param points the points which form the trapezoid
     * @param cameraMatrix the camera intrinsics matrix
     * @param tagsize the original length of the tag
     * @return the 6DOF pose of the camera relative to the tag
     */
    static Pose poseFromTrapezoid(Point[] points, float[] cameraMatrix, double tagsize, int solveMethod)
    {
        // The 3d points of the tag in an 'ideal projection'
        Point3[] arrayPoints3d = new Point3[4];
        arrayPoints3d[0] = new Point3(-tagsize/2, tagsize/2, 0);
        arrayPoints3d[1] = new Point3(tagsize/2, tagsize/2, 0);
        arrayPoints3d[2] = new Point3(tagsize/2, -tagsize/2, 0);
        arrayPoints3d[3] = new Point3(-tagsize/2, -tagsize/2, 0);

        // Using this information, actually solve for pose
        return poseFromNGrt4Pts(points, arrayPoints3d, cameraMatrix, solveMethod);
    }

    static Pose poseFromNGrt4Pts(Point[] imagePts, Point3[] idealSpacialProjectedPts, float[] cameraMatrix, int solveMethod)
    {
        // SandBot: 실제는 MatOfPoint2f·MatOfPoint3f(float로 자름) → Calib3d.solvePnP(…, new MatOfDouble(), rvec, tvec, false, …).
        // 해가 없으면 rvec·tvec는 처음 값 그대로다 [가정: 초기화하지 않은 Mat은 0]
        float[] points2d = new float[imagePts.length * 2];
        for (int i = 0; i < imagePts.length; i++)
        {
            points2d[2 * i] = (float) imagePts[i].x;
            points2d[2 * i + 1] = (float) imagePts[i].y;
        }
        float[] points3d = new float[idealSpacialProjectedPts.length * 3];
        for (int i = 0; i < idealSpacialProjectedPts.length; i++)
        {
            points3d[3 * i] = (float) idealSpacialProjectedPts[i].x;
            points3d[3 * i + 1] = (float) idealSpacialProjectedPts[i].y;
            points3d[3 * i + 2] = (float) idealSpacialProjectedPts[i].z;
        }

        Pose pose = new Pose();
        Pnp.solvePnP(points3d, points2d, cameraMatrix, solveMethod, pose.rvec, pose.tvec);

        return pose;
    }

    /*
     * A simple container to hold both rotation and translation
     * vectors, which together form a 6DOF pose.
     */
    static class Pose
    {
        // SandBot: 실제는 new Mat(3, 1, CV_32F)
        float[] rvec = new float[3];
        float[] tvec = new float[3];
    }

    static class TagClusterNotebook
    {
        private AprilTagClusterMetadata cluster;
        private ArrayList<PreliminaryTagDetection> detections = new ArrayList<>();

        TagClusterNotebook(AprilTagClusterMetadata cluster)
        {
            this.cluster = cluster;
        }

        boolean isFor(AprilTagClusterMetadata cluster)
        {
            return this.cluster == cluster;
        }

        void note(PreliminaryTagDetection det)
        {
            detections.add(det);
        }
    }

    static class PreliminaryTagDetection
    {
        final int id;
        final Point center;
        final Point[] corners;

        // SandBot: 실제는 네이티브 검출 포인터(ptrNativeDetection)도 둔다
        PreliminaryTagDetection(int id, Point center, Point[] corners)
        {
            this.id = id;
            this.center = center;
            this.corners = corners;
        }
    }

    static class PreliminaryFrameFindings
    {
        ArrayList<TagClusterNotebook> clusterNotebooks;
        ArrayList<PreliminaryTagDetection> singleTags;

        PreliminaryFrameFindings()
        {
            clusterNotebooks = new ArrayList<>();
            singleTags = new ArrayList<>();
        }

        void noteSingleTag(PreliminaryTagDetection detection)
        {
            singleTags.add(detection);
        }

        void noteClusterTag(PreliminaryTagDetection detection, AprilTagClusterMetadata parentCluster)
        {
            // do we already have a notebook that matches?
            for (TagClusterNotebook notebook : clusterNotebooks)
            {
                if (notebook.isFor(parentCluster))
                {
                    notebook.note(detection);
                    return;
                }
            }

            // no, we need to make a new one
            TagClusterNotebook n = new TagClusterNotebook(parentCluster);
            n.note(detection);
            clusterNotebooks.add(n);
        }
    }
}
