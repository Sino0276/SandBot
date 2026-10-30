package com.acmerobotics.dashboard;

import com.acmerobotics.dashboard.config.ConstantProvider;
import com.acmerobotics.dashboard.config.ValueProvider;
import com.acmerobotics.dashboard.config.reflection.FieldProvider;
import com.acmerobotics.dashboard.config.variable.BasicVariable;
import com.acmerobotics.dashboard.config.variable.ConfigVariable;
import com.acmerobotics.dashboard.config.variable.CustomVariable;
import com.acmerobotics.dashboard.config.variable.VariableType;
import com.qualcomm.robotcore.util.RobotLog;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * SandBot: Dashboard 설정 트리(CustomVariable)를 호스트로 보내는 모양(src/shared/dashboard.ts의 DashConfigNode)으로 쓰고, Config 탭의
 * 값 바꾸기(DashConfigSet)를 적용한다.
 *
 * <ul>
 *   <li>자식은 이름순(실제 CustomVariable은 HashMap이라 정렬해 결정적으로 보낸다).
 *   <li>값은 ValueProvider.get()의 글자: Double·Float는 Double.toString·Float.toString, enum은 name(), null은 "null", 그 밖은
 *       toString. 형식은 BasicVariable의 VariableType이고, 기본 형식이 아닌 값(CUSTOM 형식의 BasicVariable)은 읽기 전용 글자로
 *       보인다. enum은 상수 이름들(선언 순서, 실제 직렬화처럼 @Deprecated 상수는 뺀다)을 함께 준다.
 *   <li>source: FieldProvider면 그 Field의 선언 클래스 바이너리 이름과 필드 이름(배열 원소·다른 Provider는 null). 렌더러가 TeamCode
 *       튜닝 값과 맞춘다.
 *   <li>값 바꾸기: 경로로 변수를 찾아 형식에 맞게 읽고(boolean true·false, 정수는 범위 안, float·double은 유한, enum은 상수 이름,
 *       string은 그대로, 읽기 전용은 거부) 실제 SAVE_CONFIG처럼 BasicVariable.update로 provider.set한다. 실패하면 영어 경고 로그를
 *       남기고 버린다.
 * </ul>
 */
final class SandbotDashboardConfig {
    private SandbotDashboardConfig() {}

    private static final String TAG = "FtcDashboard";

    private static final Field BASIC_PROVIDER = field(BasicVariable.class, "provider");
    private static final Field CUSTOM_VARIABLES = field(CustomVariable.class, "variables");
    private static final Field FIELD_PROVIDER_FIELD = field(FieldProvider.class, "field");

    private static Field field(Class<?> type, String name) {
        try {
            Field f = type.getDeclaredField(name);
            f.setAccessible(true);
            return f;
        } catch (NoSuchFieldException e) {
            throw new IllegalStateException("FTC Dashboard " + type.getName() + " has no field " + name, e);
        }
    }

    private static Object read(Field f, Object owner) {
        try {
            return f.get(owner);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- 트리

    private static final class Budget {
        int nodes;
    }

    static String tree(CustomVariable root, SandbotDashboardJson json) {
        StringBuilder out = new StringBuilder();
        custom(out, root, 0, new Budget(), json);
        return out.toString();
    }

    /** 이름순 자식(CustomVariable(null)이면 없음) */
    @SuppressWarnings("unchecked")
    private static Map<String, ConfigVariable<?>> children(CustomVariable variable) {
        Map<String, ConfigVariable<?>> sorted = new TreeMap<>();
        Map<String, ConfigVariable<?>> variables = (Map<String, ConfigVariable<?>>) read(CUSTOM_VARIABLES, variable);
        if (variables == null) return sorted;
        for (Map.Entry<String, ConfigVariable<?>> e : variables.entrySet())
            if (e.getKey() != null && e.getValue() != null) sorted.put(e.getKey(), e.getValue());
        return sorted;
    }

    private static void custom(StringBuilder out, CustomVariable variable, int depth, Budget budget,
            SandbotDashboardJson json) {
        out.append("{\"kind\":\"custom\",\"children\":[");
        boolean first = true;
        if (depth >= SandbotDashboardJson.MAX_CONFIG_DEPTH) {
            if (!children(variable).isEmpty())
                json.warnOnce("configDepth", "the Dashboard config tree is deeper than "
                        + SandbotDashboardJson.MAX_CONFIG_DEPTH + " levels; deeper variables are not shown");
        } else {
            for (Map.Entry<String, ConfigVariable<?>> e : children(variable).entrySet()) {
                if (budget.nodes >= SandbotDashboardJson.MAX_CONFIG_NODES
                        || out.length() > SandbotDashboardJson.MAX_CONFIG_CHARS) {
                    json.warnOnce("configNodes", "the Dashboard config tree has more than "
                            + SandbotDashboardJson.MAX_CONFIG_NODES + " variables or is too large; the rest is not shown");
                    break;
                }
                if (e.getKey().length() > SandbotDashboardJson.MAX_TEXT) {
                    json.warnOnce("configName", "a Dashboard config variable name longer than "
                            + SandbotDashboardJson.MAX_TEXT + " characters is not shown");
                    continue;
                }
                budget.nodes++;
                if (!first) out.append(',');
                first = false;
                out.append("{\"name\":");
                SandbotDashboardJson.string(out, e.getKey());
                out.append(",\"node\":");
                ConfigVariable<?> child = e.getValue();
                if (child instanceof CustomVariable) custom(out, (CustomVariable) child, depth + 1, budget, json);
                else value(out, child, json);
                out.append('}');
            }
        }
        out.append("]}");
    }

    private static void value(StringBuilder out, ConfigVariable<?> variable, SandbotDashboardJson json) {
        VariableType type = variable.getType();
        Object value;
        try {
            value = variable.getValue();
        } catch (RuntimeException e) {
            json.warnOnce("configGet", "a Dashboard config value could not be read: " + e);
            value = null;
        }
        String wire = wireType(type);
        String text;
        if (value == null) text = "null";
        else if (value instanceof Enum) text = ((Enum<?>) value).name();
        else text = String.valueOf(value);
        out.append("{\"kind\":\"value\",\"type\":");
        SandbotDashboardJson.string(out, wire);
        out.append(",\"value\":");
        SandbotDashboardJson.string(out, json.clip(text, "configValue"));
        out.append(",\"enumValues\":[");
        if (type == VariableType.ENUM) {
            Class<?> enumClass = enumClass(variable, value);
            if (enumClass != null) {
                List<String> names = enumNames(enumClass);
                for (int i = 0; i < names.size(); i++) {
                    if (i == SandbotDashboardJson.MAX_CONFIG_NODES || out.length() > SandbotDashboardJson.MAX_CONFIG_CHARS) {
                        json.warnOnce("configEnum", "a Dashboard config enum has too many constants; the rest is not shown");
                        break;
                    }
                    if (i > 0) out.append(',');
                    SandbotDashboardJson.string(out, json.clip(names.get(i), "configValue"));
                }
            }
        }
        out.append("],\"source\":");
        Field source = sourceField(variable);
        if (source == null) {
            out.append("null");
        } else {
            out.append("{\"declaringClass\":");
            SandbotDashboardJson.string(out, source.getDeclaringClass().getName());
            out.append(",\"field\":");
            SandbotDashboardJson.string(out, source.getName());
            out.append('}');
        }
        out.append('}');
    }

    /** VariableType → 와이어 형식(DashVariableType). 기본 형식이 아니면 읽기 전용 글자. */
    private static String wireType(VariableType type) {
        if (type == null) return "readonlyString";
        switch (type) {
            case BOOLEAN:
                return "boolean";
            case INT:
                return "int";
            case LONG:
                return "long";
            case FLOAT:
                return "float";
            case DOUBLE:
                return "double";
            case STRING:
                return "string";
            case ENUM:
                return "enum";
            case READONLY_STRING:
            case CUSTOM:
            default:
                return "readonlyString";
        }
    }

    private static ValueProvider<?> providerOf(ConfigVariable<?> variable) {
        if (!(variable instanceof BasicVariable)) return null;
        return (ValueProvider<?>) read(BASIC_PROVIDER, variable);
    }

    /** FieldProvider로 읽는 변수의 필드(배열 원소·다른 provider는 null) */
    private static Field sourceField(ConfigVariable<?> variable) {
        ValueProvider<?> provider = providerOf(variable);
        if (provider == null || provider.getClass() != FieldProvider.class) return null;
        return (Field) read(FIELD_PROVIDER_FIELD, provider);
    }

    /** enum 변수의 enum 형식(필드의 형식, 아니면 지금 값의 형식) */
    private static Class<?> enumClass(ConfigVariable<?> variable, Object value) {
        Field field = sourceField(variable);
        if (field != null && field.getType().isEnum()) return field.getType();
        if (value instanceof Enum) return ((Enum<?>) value).getDeclaringClass();
        return null;
    }

    private static List<String> enumNames(Class<?> enumClass) {
        List<String> names = new ArrayList<>();
        Object[] constants = enumClass.getEnumConstants();
        if (constants == null) return names;
        for (Object o : constants) {
            String name = ((Enum<?>) o).name();
            try {
                if (enumClass.getField(name).isAnnotationPresent(Deprecated.class)) continue;
            } catch (NoSuchFieldException | SecurityException ignored) {
                // 실제 직렬화와 같게 넣는다
            }
            names.add(name);
        }
        return names;
    }

    // ---- 값 바꾸기

    /** Config 탭의 값 하나를 적용한다. 받지 못하면 영어 경고 로그를 남기고 버린다. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static void set(Mutex<CustomVariable> root, List<String> path, String text) {
        root.with(r -> {
            String where = String.join("/", path);
            ConfigVariable<?> variable = r;
            for (String name : path) {
                variable = variable instanceof CustomVariable ? children((CustomVariable) variable).get(name) : null;
                if (variable == null) break;
            }
            if (!(variable instanceof BasicVariable)) {
                RobotLog.ww(TAG, "Dashboard config: no variable at " + where);
                return;
            }
            VariableType type = variable.getType();
            Object value;
            try {
                value = parse(type, text, variable);
            } catch (IllegalArgumentException e) {
                RobotLog.ww(TAG, "Dashboard config: " + where + ": " + e.getMessage());
                return;
            }
            try {
                ((BasicVariable) variable).update(new BasicVariable(type, new ConstantProvider(value)));
            } catch (RuntimeException e) {
                RobotLog.ww(TAG, "Dashboard config: " + where + " could not be set: " + e);
            }
        });
    }

    private static Object parse(VariableType type, String text, ConfigVariable<?> variable) {
        if (type == null) throw new IllegalArgumentException("read-only");
        switch (type) {
            case BOOLEAN:
                if (text.equals("true")) return Boolean.TRUE;
                if (text.equals("false")) return Boolean.FALSE;
                throw new IllegalArgumentException("not a boolean: " + text);
            case INT:
                try {
                    return Integer.parseInt(text);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("not an int: " + text);
                }
            case LONG:
                try {
                    return Long.parseLong(text);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("not a long: " + text);
                }
            case FLOAT: {
                float f;
                try {
                    f = Float.parseFloat(text);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("not a float: " + text);
                }
                if (Float.isNaN(f) || Float.isInfinite(f)) throw new IllegalArgumentException("not finite: " + text);
                return f;
            }
            case DOUBLE: {
                double d;
                try {
                    d = Double.parseDouble(text);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("not a double: " + text);
                }
                if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalArgumentException("not finite: " + text);
                return d;
            }
            case STRING:
                return text;
            case ENUM: {
                Object current;
                try {
                    current = variable.getValue();
                } catch (RuntimeException e) {
                    current = null;
                }
                Class<?> enumClass = enumClass(variable, current);
                if (enumClass != null) {
                    for (Object o : enumClass.getEnumConstants())
                        if (((Enum<?>) o).name().equals(text)) return o;
                }
                throw new IllegalArgumentException("not a constant of the enum: " + text);
            }
            default:
                throw new IllegalArgumentException("read-only");
        }
    }
}
