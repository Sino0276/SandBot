package org.sandbot.runtime;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Consumer;

/**
 * Road Runner ftc의 튜닝 결과 폴더(TuningFiles). 실제 로봇에서는 {@code @WebHandlerRegistrar TuningFiles.registerRoutes}가
 * {@code ROOT_FOLDER/RoadRunner/tuning/<종류>/}를 만들고, 램프 로거 OpMode가 끝날 때 TuningFiles.save가 그 안에
 * {@code <currentTimeMillis>.json}을 쓴다(Jackson). 사이드카는 웹 처리기를 등록하지 않으므로(웹 서버가 없다) 클래스패스에
 * TuningFiles가 있으면 실행 전에 폴더만 만들고, 실행 뒤 새로 생긴 .json을 알린다(notice rrTuningSaved, 모의 저장소 기준 경로).
 * 종류 이름은 ftc 0.1.25의 TuningFiles.FileType(baseName)이다.
 */
final class RrTuning {
    static final String CLASS_RESOURCE = "com/acmerobotics/roadrunner/ftc/TuningFiles.class";
    /** TuningFiles.FileType의 baseName(FORWARD_RAMP·LATERAL_RAMP·ANGULAR_RAMP·ACCEL) */
    static final List<String> KINDS = Collections.unmodifiableList(
            Arrays.asList("forward-ramp", "lateral-ramp", "angular-ramp", "accel"));

    private final File firstFolder;
    private final File root;
    /** 실행 전에 있던 .json(모의 저장소 기준 경로) */
    private final Set<String> before;

    private RrTuning(File firstFolder) {
        this.firstFolder = firstFolder;
        // TuningFiles.<clinit>: new File(AppUtil.ROOT_FOLDER + "/RoadRunner/tuning/")
        this.root = new File(new File(firstFolder, "RoadRunner"), "tuning");
        this.before = jsonFiles();
    }

    /**
     * 클래스패스(로더)에 TuningFiles가 있으면 폴더를 만들고 지금 있는 결과를 기억한다. 없으면 null. 만들지 못한 폴더는 warn으로
     * 알린다(영어).
     */
    static RrTuning prepare(ClassLoader loader, File firstFolder, Consumer<String> warn) {
        if (loader.getResource(CLASS_RESOURCE) == null) return null;
        RrTuning tuning = new RrTuning(firstFolder);
        for (String kind : KINDS) {
            File dir = new File(tuning.root, kind);
            if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory())
                warn.accept("W/SandBot: could not create the Road Runner tuning folder " + tuning.relative(dir));
        }
        return tuning;
    }

    /** 실행 전에 없던 .json(이름순, 모의 저장소 기준 경로, '/'로 나눔) */
    List<String> savedSince() {
        List<String> saved = new ArrayList<>();
        for (String path : jsonFiles()) if (!before.contains(path)) saved.add(path);
        return saved;
    }

    private Set<String> jsonFiles() {
        Set<String> out = new TreeSet<>();
        for (String kind : KINDS) {
            File[] files = new File(root, kind).listFiles();
            if (files == null) continue;
            for (File file : files) {
                if (file.isFile() && file.getName().endsWith(".json")) out.add(relative(file));
            }
        }
        return out;
    }

    private String relative(File file) {
        return firstFolder.toPath().relativize(file.toPath()).toString().replace(File.separatorChar, '/');
    }
}
