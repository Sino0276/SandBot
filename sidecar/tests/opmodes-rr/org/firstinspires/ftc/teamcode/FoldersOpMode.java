package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

// AppUtil의 폴더는 모의 저장소(RunRequest.firstFolder) 아래다. ROBOT_DATA_DIR에 쓰고 다시 읽는다.
@TeleOp(name = "Folders")
public class FoldersOpMode extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        System.out.println("RESULT root=" + AppUtil.ROOT_FOLDER.getPath());
        System.out.println("RESULT sameFirst=" + AppUtil.FIRST_FOLDER.equals(AppUtil.ROOT_FOLDER));
        System.out.println("RESULT data=" + AppUtil.getInstance().getRelativePath(AppUtil.ROOT_FOLDER, AppUtil.ROBOT_DATA_DIR));
        System.out.println("RESULT settings=" + AppUtil.getInstance().getRelativePath(AppUtil.ROOT_FOLDER,
                AppUtil.getInstance().getSettingsFile("pid.txt")));
        System.out.println("RESULT activity=" + AppUtil.getInstance().getActivity()
                + " rc=" + AppUtil.getInstance().isRobotController() + " sdk=" + AppUtil.getSdkVersionString());
        AppUtil.getInstance().ensureDirectoryExists(AppUtil.ROBOT_DATA_DIR);
        File saved = new File(AppUtil.ROBOT_DATA_DIR, "pose.txt");
        try {
            Files.write(saved.toPath(), "1.5,2.5".getBytes(StandardCharsets.UTF_8));
            System.out.println("RESULT readBack=" + new String(Files.readAllBytes(saved.toPath()), StandardCharsets.UTF_8));
        } catch (IOException e) {
            System.out.println("RESULT readBack=" + e);
        }
        try {
            AppUtil.getInstance().showToast(null, "hi");
            System.out.println("RESULT toast=shown");
        } catch (RuntimeException e) {
            System.out.println("RESULT toast=" + e.getClass().getSimpleName());
        }
        waitForStart();
    }
}
