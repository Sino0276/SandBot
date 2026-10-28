package org.firstinspires.ftc.teamcode;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.algorithm.ForesightConfig;
import com.pedropathing.api.Paths;
import com.pedropathing.controllers.Controller;
import com.pedropathing.follower.Follower;
import com.pedropathing.math.Matrix;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.drivetrains.MecanumConfig;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.revhub.localizers.PinpointLocalizer;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/**
 * 라이브러리 시험(Pedro Pathing 3.0.2, 실제 jar): 메카넘 + Pinpoint 로컬라이저로 Follower가 앞으로 24 in 직선 경로를 따라가 끝난다.
 * 팀이 Constants.java에 쓰는 것처럼 설정한다(Quickstart 3.x 형식). 로봇은 sandbot_lib_bot.xml(왼쪽 모터 REVERSE, Pinpoint X 포드
 * 왼쪽 100 mm·Y 포드 뒤 80 mm). 끝나면 "RESULT x=… y=… h=… busy=… millis=… loops=…"(in, rad, 가상 ms).
 */
@Autonomous(name = "Pedro Follow")
public class PedroFollow extends LinearOpMode {
    static Follower create(com.qualcomm.robotcore.hardware.HardwareMap hardwareMap) {
        MecanumConfig drive = new MecanumConfig(c -> {
            c.frontLeftName.set("frontLeft");
            c.frontRightName.set("frontRight");
            c.backLeftName.set("backLeft");
            c.backRightName.set("backRight");
            c.frontLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.backLeftDirection.set(DcMotorSimple.Direction.REVERSE);
            c.frontRightDirection.set(DcMotorSimple.Direction.FORWARD);
            c.backRightDirection.set(DcMotorSimple.Direction.FORWARD);
        });
        PinpointConfig localizer = new PinpointConfig(c -> {
            c.name.set("pinpoint");
            c.xPodOffset.set(100.0);
            c.yPodOffset.set(-80.0);
            c.offsetUnits.set(DistanceUnit.MM);
            c.xPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
            c.yPodDirection.set(GoBildaPinpointDriver.EncoderDirection.FORWARD);
            c.podType.set(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
        });
        ForesightConfig foresight = new ForesightConfig(c -> {
            c.headingFeedback.set(Controller.proportional(1.5));
            c.forwardTranslational.set(Controller.proportional(0.15));
            c.strafeTranslational.set(Controller.proportional(0.15));
            c.brake.set(Controller.proportionalFeedforward(1.0 / 65));
            c.coast.set(Controller.sum(Controller.proportionalFeedforward(1.0 / 65), Controller.proportional(0.01)));
            c.linearBrakeCoefficients.set(Matrix.diag(0.12, 0.12));
            c.quadraticBrakeCoefficients.set(Matrix.diag(0.004, 0.004));
            c.headingBrakeCoefficients.set(Vector2D.cartesian(0.1, 0));
            c.maxAchievableForwardVelocity.set(65.0);
            c.maxAchievableStrafeVelocity.set(55.0);
            c.naturalForwardDeceleration.set(40.0);
            c.naturalStrafeDeceleration.set(40.0);
        });
        return new Follower(new PinpointLocalizer(hardwareMap, localizer), new Mecanum(hardwareMap, drive),
                new Foresight(foresight));
    }

    @Override
    public void runOpMode() {
        Follower follower = create(hardwareMap);
        Pose start = new Pose(0, 0, 0);
        follower.setPose(start);
        follower.update();
        waitForStart();
        long started = System.nanoTime();
        follower.follow(Paths.line(start, new Pose(24, 0, 0)).constant(0));
        long loops = 0;
        while (opModeIsActive() && follower.isBusy() && System.nanoTime() - started < 8_000_000_000L) {
            follower.update();
            loops++;
        }
        Pose end = follower.pose();
        System.out.println("RESULT x=" + end.x() + " y=" + end.y() + " h=" + end.heading() + " busy="
                + follower.isBusy() + " millis=" + (System.nanoTime() - started) / 1_000_000 + " loops=" + loops);
    }
}
