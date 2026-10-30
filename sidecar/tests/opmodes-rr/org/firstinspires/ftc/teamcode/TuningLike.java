package org.firstinspires.ftc.teamcode;

import android.content.Context;

import com.qualcomm.robotcore.eventloop.opmode.AnnotatedOpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManager;
import com.qualcomm.robotcore.eventloop.opmode.OpModeRegistrar;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeMeta;

import java.util.Arrays;
import java.util.List;

// Road Runner quickstart의 TuningOpModes처럼: @TeleOp 없는 OpMode를 등록기가 인스턴스·클래스로 등록하고 이름은 실행 때 계산한다.
// 같은 이름·같은 클래스를 다시 등록하면 뒤의 것은 버린다. static이 아니거나 public이 아닌 등록기 메서드는 실제 SDK처럼 부르지 않는다.
public final class TuningLike {
    public static final String GROUP = "quickstart";
    public static final boolean DISABLED = false;

    private TuningLike() {}

    interface TunerFactory {
        OpMode make(String label);
    }

    private static OpModeMeta metaForClass(Class<? extends OpMode> cls) {
        return new OpModeMeta.Builder()
                .setName(cls.getSimpleName())
                .setGroup(GROUP)
                .setFlavor(OpModeMeta.Flavor.TELEOP)
                .build();
    }

    @OpModeRegistrar
    public static void register(OpModeManager manager) {
        if (DISABLED) return;
        TunerFactory factory = label -> new FactoryTuner(label);
        for (String label : new String[] {"Forward", "Lateral"}) {
            OpMode tuner = factory.make(label);
            manager.register(
                    new OpModeMeta.Builder()
                            .setName(label + tuner.getClass().getSimpleName())
                            .setGroup(GROUP)
                            .setFlavor(OpModeMeta.Flavor.TELEOP)
                            .build(),
                    tuner);
        }
        List<Class<? extends OpMode>> classes = Arrays.asList(SplineLike.class, LocalizationLike.class);
        for (Class<? extends OpMode> cls : classes) manager.register(metaForClass(cls), cls);
        // 이미 등록한 클래스(실제 isKnown): 버린다
        manager.register("ByName", SplineLike.class);
        manager.register(
                new OpModeMeta.Builder()
                        .setName("AutoLike")
                        .setFlavor(OpModeMeta.Flavor.AUTONOMOUS)
                        .setTransitionTarget("SplineLike")
                        .build(),
                new FactoryTuner("auto"));
        manager.register(
                new OpModeMeta.Builder().setName("UtilityLike").setFlavor(OpModeMeta.Flavor.UTILITY).build(),
                UtilityLike.class);
        // 이미 있는 이름: 버린다
        manager.register("SplineLike", new FactoryTuner("duplicate"));
        // 애너테이션에서 이름·group을 읽는다(@Disabled는 보지 않는다)
        ((AnnotatedOpModeManager) manager).register(AnnotatedTuner.class);
    }

    @OpModeRegistrar
    public static void zzWithContext(Context context, OpModeManager manager) {
        manager.register("WithContext-" + (context == null), new FactoryTuner("context"));
    }

    @OpModeRegistrar
    public void notStatic(OpModeManager manager) {
        manager.register("NotStatic", new FactoryTuner("x"));
    }

    @OpModeRegistrar
    static void notPublic(OpModeManager manager) {
        manager.register("NotPublic", new FactoryTuner("x"));
    }
}
