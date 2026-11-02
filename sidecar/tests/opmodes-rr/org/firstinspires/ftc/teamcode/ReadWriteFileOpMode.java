package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.util.ReadWriteFile;

import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

import java.io.File;
import java.io.IOException;

// SDK의 파일 도움 함수(ReadWriteFile)로 AppUtil 폴더(모의 저장소)에 쓰고 읽는다. SDK 샘플 SensorBNO055IMUCalibration과
// Autonomous 끝 자세를 TeleOp에 넘기는 흔한 방법(getSettingsFile + writeFile/readFile)이다.
@Autonomous(name = "ReadWriteFile")
public class ReadWriteFileOpMode extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        File pose = AppUtil.getInstance().getSettingsFile("pose.txt");
        ReadWriteFile.writeFile(pose, "1.5,2.5,0.3");
        System.out.println("RESULT read=" + ReadWriteFile.readFile(pose));
        // 없는 폴더도 만든다(writeFileOrThrow → ensureDirectoryExists)
        File handoff = new File(new File(AppUtil.ROBOT_DATA_DIR, "auto"), "handoff.txt");
        try {
            ReadWriteFile.writeFileOrThrow(handoff, "héading=90");
            System.out.println("RESULT handoff=" + ReadWriteFile.readFileOrThrow(handoff));
        } catch (IOException e) {
            System.out.println("RESULT handoff=" + e);
        }
        // 실제 readBytesOrThrow는 읽은 길이가 아니라 버퍼(1000바이트) 전체를 쓴다
        System.out.println("RESULT bytes=" + ReadWriteFile.readFileBytes(pose).length);
        File missing = new File(AppUtil.ROBOT_SETTINGS, "missing.txt");
        System.out.println("RESULT missing=[" + ReadWriteFile.readFile(missing) + "]");
        try {
            ReadWriteFile.readFileOrThrow(missing);
            System.out.println("RESULT missingThrow=none");
        } catch (IOException e) {
            System.out.println("RESULT missingThrow=" + e.getClass().getSimpleName());
        }
        // 커밋이 필요한 갱신과, 남은 이전 판(.old_version) 되살리기
        ReadWriteFile.updateFileRequiringCommit(pose, "3,4,0.5");
        File old = new File(pose.getPath() + ".old_version");
        System.out.println("RESULT updated=" + ReadWriteFile.readFile(pose) + " oldLeft=" + old.exists());
        File crashed = new File(AppUtil.ROBOT_SETTINGS, "crashed.txt");
        ReadWriteFile.writeFile(crashed, "partial");
        ReadWriteFile.writeFile(new File(crashed.getPath() + ".old_version"), "complete");
        ReadWriteFile.ensureAllChangesAreCommitted(AppUtil.ROBOT_SETTINGS);
        System.out.println("RESULT recovered=" + ReadWriteFile.readFile(crashed));
        try {
            ReadWriteFile.readAssetBytes(new File("model.tflite"));
            System.out.println("RESULT asset=read");
        } catch (RuntimeException e) {
            System.out.println("RESULT asset=" + e.getClass().getSimpleName());
        }
        waitForStart();
    }
}
