package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.android.util.Size;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibration;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibrationIdentity;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.PlaceholderCalibratedAspectRatioMismatch;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.VendorProductCalibrationIdentity;
import org.firstinspires.ftc.robotcore.internal.system.Misc;
import org.sandbot.sim.Sim;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;

/**
 * SDK 웹캠 보정 조회(spec-4d §1.13): RobotCore 12.0 CameraCalibrationManager(:107–480)·CameraCalibrationHelper의 규칙을 옮겼다.
 * 실제 클래스는 안드로이드 자원(R.xml)과 XmlPullParser를 써서 stub이다. 내장 보정은 sandbot-sdk.jar의 자원
 * org/sandbot/sdk/devices/builtinwebcamcalibrations.xml(빌드가 RobotCore AAR에서 꺼낸 그 파일, sha256 43febb0e…5106)이고, 팀
 * 보정은 런타임이 Sim.installCameraCalibrations로 넣은 TeamCode/src/main/res/xml/teamwebcamcalibrations.xml이다(내장 다음).
 *
 * <p>해석은 실제 풀 파서 순서 그대로다(StAX로 같은 사건열): 루트 CalibrationRoot|Calibrations, 카메라 CameraDevice|Camera, 보정
 * Calibration. vid는 Integer.decode 또는 UsbConstants.VENDOR_ID_* 이름, pid는 Integer.decode(앞의 0은 8진수). vid·pid가 0이거나
 * 틀리면 그 Camera 요소의 자식을 건너뛰지 않아(실제 코드) 첫 자식의 끝에서 Calibrations가 끝나 그 뒤 Camera는 모두 무시된다.
 * 숫자 목록은 쉼표를 공백으로 바꿔 \\s+로 나누고(앞 공백이면 빈 칸이 생겨 그 요소를 버린다) size·focalLength·principalPoint는
 * 2개, distortionCoefficients는 8개여야 한다. 같은 크기의 보정을 덮으면 목록 끝으로 간다. 파일 전체가 버려지는 것은 XML 문법
 * 오류뿐이고 그때도 그 앞까지 넣은 보정은 남는다.
 *
 * <p>SandBot이 더하는 것: 실제 로봇은 버린 요소를 알리지 않지만 팀 파일에서 버린 요소마다 notice visionCalibrationSkipped를 낸다.
 * DTD·외부 엔티티는 받지 않는다(DOCTYPE이 있으면 파일을 버리고 알린다, 실제와 다른 보안 제한). 팀 파일은 처음 조회할 때 읽는다
 * (안내를 낼 호스트가 있을 때).
 */
public final class SandbotCameraCalibrations {
    private SandbotCameraCalibrations() {}

    /** CameraCalibrationManager.TAG */
    private static final String TAG = "CameraCalibrationManager";
    static final String BUILTIN_RESOURCE = "builtinwebcamcalibrations.xml";

    private static Map<CameraCalibrationIdentity, List<CameraCalibration>> calibrationMap;

    /** CameraCalibrationHelper.getCalibration: identity가 null이면 null, 아니면 getCalibration(없으면 forUnavailable) */
    public static synchronized CameraCalibration getCalibration(CameraCalibrationIdentity identity, int width, int height) {
        if (identity == null) return null;
        Size size = new Size(width, height);
        CameraCalibration result = internalGetCalibration(identity, size);
        if (result == null) result = CameraCalibration.forUnavailable(identity, size);
        return result;
    }

    /** CameraCalibrationHelper.getCalibrations(없으면 빈 목록: 실제는 null이라 for-each가 던지지만 Placeholder면 늘 있다) */
    public static synchronized List<CameraCalibration> calibrationsFor(CameraCalibrationIdentity identity) {
        List<CameraCalibration> list = map().get(identity);
        return list == null ? Collections.<CameraCalibration>emptyList() : new ArrayList<>(list);
    }

    /** 시험용 팀 파일(null이 아니면 Sim.cameraCalibrationsFile 대신) */
    private static File teamForTest;

    /** 시험용: 읽은 보정을 버리고 다음 조회에서 이 팀 파일(null이면 내장만)로 다시 읽는다 */
    public static synchronized void reloadForTest(File team) {
        teamForTest = team;
        calibrationMap = null;
    }

    private static Map<CameraCalibrationIdentity, List<CameraCalibration>> map() {
        if (calibrationMap == null) {
            calibrationMap = new LinkedHashMap<>();
            InputStream builtin = SandbotCameraCalibrations.class.getResourceAsStream(BUILTIN_RESOURCE);
            if (builtin == null) {
                RobotLog.ee(TAG, "the SDK built-in webcam calibrations are missing from this build");
            } else {
                try {
                    new Parser(false).parse(builtin);
                } finally {
                    close(builtin);
                }
            }
            File team = teamForTest != null ? teamForTest : Sim.installed() ? Sim.cameraCalibrationsFile() : null;
            if (team != null) {
                try (InputStream in = new FileInputStream(team)) {
                    new Parser(true).parse(in);
                } catch (IOException e) {
                    RobotLog.ee(TAG, e, "exception opening XML file %s; ignoring", team);
                }
            }
        }
        return calibrationMap;
    }

    private static void close(InputStream in) {
        try {
            in.close();
        } catch (IOException e) {
            // 무시
        }
    }

    /** CameraCalibrationManager.addCalibration(:107) */
    private static void addCalibration(CameraCalibrationIdentity vidpid, CameraCalibration calibration) {
        List<CameraCalibration> calibrations = calibrationMap.containsKey(vidpid) ? calibrationMap.get(vidpid)
                : new ArrayList<CameraCalibration>();
        for (int i = 0; i < calibrations.size(); i++) {
            CameraCalibration existing = calibrations.get(i);
            if (calibration.getSize().equals(existing.getSize())) {
                calibrations.remove(i);
                break;
            }
        }
        if (!calibration.getRemove()) {
            calibrations.add(calibration);
            calibrationMap.put(vidpid, calibrations);
        }
    }

    /** CameraCalibrationManager.internalGetCalibration(:387) */
    private static CameraCalibration internalGetCalibration(CameraCalibrationIdentity identity, Size size) {
        CameraCalibration result = null;
        if (identity != null && !identity.isDegenerate()) {
            List<CameraCalibration> calibrationList = map().get(identity);
            if (calibrationList != null) {
                // Do we have an exact match?
                for (CameraCalibration calibration : calibrationList) {
                    if (calibration.getSize().equals(size)) {
                        result = calibration;
                        break;
                    }
                }
                if (result == null) {
                    // If no exact match, is there one with the same aspect ratio we can scale?
                    CameraCalibration[] sameAspectRatios = getCameraCalibrationsWithAspectRatio(calibrationList, size);
                    if (sameAspectRatios.length > 0) {
                        result = sameAspectRatios[0].scaledTo(size);
                    } else if (calibrationList.size() > 0) {
                        result = new PlaceholderCalibratedAspectRatioMismatch(identity, size);
                    }
                }
            }
        }
        return result;
    }

    /** CameraCalibrationManager.getCameraCalibrationsWithAspectRatio: 같은 종횡비, 대각선 차 오름차순 안정 정렬 */
    private static CameraCalibration[] getCameraCalibrationsWithAspectRatio(List<CameraCalibration> calibrationList,
            Size targetSize) {
        double targetAspectRatio = (double) targetSize.getWidth() / (double) targetSize.getHeight();
        List<CameraCalibration> list = new ArrayList<>();
        for (CameraCalibration calibration : calibrationList) {
            if (Misc.approximatelyEquals(calibration.getAspectRatio(), targetAspectRatio)) list.add(calibration);
        }
        final double targetDiagonal = CameraCalibration.getDiagonal(targetSize);
        CameraCalibration[] result = list.toArray(new CameraCalibration[list.size()]);
        Arrays.sort(result, new Comparator<CameraCalibration>() {
            @Override public int compare(CameraCalibration lhs, CameraCalibration rhs) {
                double leftDiff = Math.abs(lhs.getDiagonal() - targetDiagonal);
                double rightDiff = Math.abs(rhs.getDiagonal() - targetDiagonal);
                double diff = leftDiff - rightDiff;
                if (diff < 0) return -1;
                else if (diff > 0) return 1;
                else return 0;
            }
        });
        return result;
    }

    // ---- 해석(실제 XmlPullParser 순서를 StAX로) ----

    /** 버린 요소 하나(시험이 문구를 본다) */
    static final class Skipped extends RuntimeException {
        private static final long serialVersionUID = 1L;

        Skipped(String message) {
            super(message);
        }
    }

    private static final class Parser {
        private final boolean team;
        private XMLStreamReader parser;
        /** 실제 풀 파서의 사건(시작·끝·그 밖) */
        private static final int START_TAG = 2;
        private static final int END_TAG = 3;
        private static final int END_DOCUMENT = 1;
        private static final int OTHER = 4;

        Parser(boolean team) {
            this.team = team;
        }

        private void skipped(String detail) {
            if (!team) return;
            Map<String, String> params = new LinkedHashMap<>();
            params.put("detail", detail);
            if (Sim.installed()) Sim.host().notice("visionCalibrationSkipped", params);
        }

        void parse(InputStream in) {
            XMLInputFactory factory = XMLInputFactory.newFactory();
            // DTD·외부 엔티티를 받지 않는다(SandBot 보안 제한)
            factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
            factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
            factory.setProperty(XMLInputFactory.IS_COALESCING, true);
            try {
                parser = factory.createXMLStreamReader(in);
                addCalibrationsFromXmlParser();
            } catch (XMLStreamException | RuntimeException e) {
                if (e instanceof DoctypeRejected) {
                    skipped("DOCTYPE is not allowed");
                    RobotLog.ee(TAG, "failure parsing external camera calibrations XML; ignoring this calibration");
                    return;
                }
                RobotLog.ee(TAG, e, "failure parsing external camera calibrations XML; ignoring this calibration");
                skipped("XML syntax error (Android Studio would fail to build this resource)");
            } finally {
                if (parser != null) {
                    try {
                        parser.close();
                    } catch (XMLStreamException e) {
                        // 무시
                    }
                }
            }
        }

        private static final class DoctypeRejected extends RuntimeException {
            private static final long serialVersionUID = 1L;
        }

        private int eventType() {
            return map(parser.getEventType());
        }

        private int next() throws XMLStreamException {
            if (!parser.hasNext()) return END_DOCUMENT;
            return map(parser.next());
        }

        private static int map(int stax) {
            switch (stax) {
                case XMLStreamConstants.START_ELEMENT:
                    return START_TAG;
                case XMLStreamConstants.END_ELEMENT:
                    return END_TAG;
                case XMLStreamConstants.END_DOCUMENT:
                    return END_DOCUMENT;
                case XMLStreamConstants.DTD:
                    throw new DoctypeRejected();
                default:
                    return OTHER;
            }
        }

        private String getName() {
            return parser.getLocalName();
        }

        private void addCalibrationsFromXmlParser() throws XMLStreamException {
            int eventType = eventType();
            while (eventType != END_DOCUMENT) {
                if (eventType == START_TAG) {
                    switch (getName()) {
                        case "CalibrationRoot":
                        case "Calibrations":
                            parseCalibrations();
                            break;
                        case "CameraDevice":
                        case "Camera":
                            // SandBot: 실제는 그냥 무시한다(앞의 잘못된 Camera가 Calibrations를 일찍 끝낸 경우) — 알린다
                            skipped("Camera vid=" + getAttributeValue("VID", "vid", "Vid") + " pid="
                                    + getAttributeValue("PID", "pid", "Pid")
                                    + ": ignored because an earlier ignored Camera element ended <Calibrations> early");
                            parseIgnoreElementChildren();
                            break;
                        default:
                            parseIgnoreElementChildren();
                            break;
                    }
                }
                eventType = next();
            }
        }

        private void parseCalibrations() throws XMLStreamException {
            int eventType = next();
            while (eventType != END_TAG && eventType != END_DOCUMENT) {
                if (eventType == START_TAG) {
                    switch (getName()) {
                        case "CameraDevice":
                        case "Camera":
                            parseCameraDeviceElement();
                            break;
                        default:
                            parseIgnoreElementChildren();
                            break;
                    }
                }
                eventType = next();
            }
        }

        private void parseIgnoreElementChildren() throws XMLStreamException {
            int eventType = next();
            while (eventType != END_TAG && eventType != END_DOCUMENT) {
                if (eventType == START_TAG) parseIgnoreElementChildren(); // recurse!
                eventType = next();
            }
        }

        private void parseCameraDeviceElement() throws XMLStreamException {
            String strVid = getAttributeValue("VID", "vid", "Vid");
            String strPid = getAttributeValue("PID", "pid", "Pid");
            int vid = 0;
            int pid = 0;
            CameraCalibrationIdentity vidpid;
            String problem = null;
            try {
                vid = decodeVid(strVid);
                if (vid == 0) {
                    problem = "vid " + quote(strVid) + " is not a number or a UsbConstants vendor name";
                    throw new IllegalArgumentException("vid is zero");
                }
                pid = decodePid(strPid);
                if (pid == 0) {
                    problem = "pid " + quote(strPid) + " is not a valid number (Integer.decode: a leading 0 means octal)";
                    throw new IllegalArgumentException("pid is zero");
                }
                vidpid = new VendorProductCalibrationIdentity(vid, pid);
            } catch (RuntimeException e) {
                if (problem == null) problem = "vid " + quote(strVid) + " is not valid";
                vidpid = null;
            }
            if (vidpid == null) skipped("Camera vid=" + strVid + " pid=" + strPid + ": " + problem
                    + " (the SDK ignores the whole Camera element)");
            int eventType = next();
            while (eventType != END_TAG && eventType != END_DOCUMENT) {
                // We're useless if vidpid is null
                if (vidpid != null && eventType == START_TAG) {
                    switch (getName()) {
                        case "Calibration":
                            CameraCalibration calibration = parseCalibrationElement(vid, pid, strVid, strPid);
                            if (calibration != null) addCalibration(vidpid, calibration);
                            break;
                        default:
                            parseIgnoreElementChildren();
                            break;
                    }
                }
                eventType = next();
            }
        }

        private static String quote(String s) {
            return s == null ? "(missing)" : "\"" + s + "\"";
        }

        /** CameraCalibrationManager.decodeVid: Integer.decode 또는 "VENDOR_ID_" + 대문자(UsbConstants) */
        private static int decodeVid(String strVid) {
            try {
                return Integer.decode(strVid);
            } catch (NumberFormatException e) {
                Integer value = USB_VENDOR_IDS.get("VENDOR_ID_" + strVid.toUpperCase());
                if (value != null) return value;
            }
            return 0;
        }

        private static int decodePid(String strPid) {
            try {
                return Integer.decode(strPid);
            } catch (NumberFormatException e) {
                return 0;
            }
        }

        private CameraCalibration parseCalibrationElement(int vid, int pid, String strVid, String strPid)
                throws XMLStreamException {
            String size = getAttributeValue("size");
            String focalLength = getAttributeValue("focalLength", "focal_length");
            String principalPoint = getAttributeValue("principalPoint", "principal_point");
            String distortionCoefficients = getAttributeValue("distortionCoefficients", "distortion_coefficients");
            String remove = getAttributeValue("remove");
            parseIgnoreElementChildren(); // all our content is in the attributes
            try {
                CameraCalibrationIdentity identity = new VendorProductCalibrationIdentity(vid, pid);
                return new CameraCalibration(identity, parseIntArray(2, size, "size"),
                        parseFloatArray(2, focalLength, "focalLength"), parseFloatArray(2, principalPoint, "principalPoint"),
                        parseFloatArray(8, distortionCoefficients, "distortionCoefficients"), Boolean.parseBoolean(remove),
                        false);
            } catch (RuntimeException e) {
                skipped("Camera vid=" + strVid + " pid=" + strPid + " size=" + size + ": "
                        + (e instanceof Skipped ? e.getMessage() : String.valueOf(e.getMessage())));
                return null;
            }
        }

        private String getAttributeValue(String... candidates) {
            for (String name : candidates) {
                String value = parser.getAttributeValue(null, name);
                if (value != null) return value;
            }
            return null;
        }

        /** CameraCalibrationManager.parseIntArray(문구만 SandBot) */
        private static int[] parseIntArray(int cInt, String values, String what) {
            if (values == null) return new int[cInt];
            values = values.replace(',', ' ');
            String[] splitValues = values.split("\\s+");
            int[] result = new int[splitValues.length];
            int i = 0;
            for (String value : splitValues) {
                try {
                    result[i++] = Integer.decode(value);
                } catch (NumberFormatException e) {
                    throw new Skipped(what + " value " + quote(value) + " is not an integer"
                            + (value.isEmpty() ? " (leading whitespace?)" : ""));
                }
            }
            if (result.length != cInt)
                throw new Skipped(what + " has " + result.length + " values (expected " + cInt + ")");
            return result;
        }

        /** CameraCalibrationManager.parseFloatArray(문구만 SandBot) */
        private static float[] parseFloatArray(int cFloat, String values, String what) {
            if (values == null) return new float[cFloat];
            values = values.replace(',', ' ');
            String[] splitValues = values.split("\\s+");
            float[] result = new float[splitValues.length];
            int i = 0;
            for (String value : splitValues) {
                try {
                    result[i++] = Float.parseFloat(value);
                } catch (NumberFormatException e) {
                    throw new Skipped(what + " value " + quote(value) + " is not a number"
                            + (value.isEmpty() ? " (leading whitespace?)" : ""));
                }
            }
            if (result.length != cFloat)
                throw new Skipped(what + " has " + result.length + " values (expected " + cFloat + ")");
            return result;
        }
    }

    /** RobotCore 12.0 UsbConstants.VENDOR_ID_*(:231–299, decodeVid가 리플렉션으로 찾는 이름) */
    private static final Map<String, Integer> USB_VENDOR_IDS = new LinkedHashMap<>();

    static {
        Object[][] ids = {
            {"MICROSOFT", 0x045E}, {"LOGITECH", 0x046D}, {"ARDUCAM", 0xC45}, {"FTDI", 0x0403}, {"AUSDOM", 3034},
            {"GOOGLE", 0x18d1}, {"INTEL", 0x8087}, {"HTC", 0x0bb4}, {"SAMSUNG", 0x04e8}, {"MOTOROLA", 0x22b8},
            {"LGE", 0x1004}, {"HUAWEI", 0x12D1}, {"ACER", 0x0502}, {"SONY_ERICSSON", 0x0FCE}, {"FOXCONN", 0x0489},
            {"DELL", 0x413c}, {"NVIDIA", 0x0955}, {"GARMIN_ASUS", 0x091E}, {"SHARP", 0x04dd}, {"ZTE", 0x19D2},
            {"KYOCERA", 0x0482}, {"PANTECH", 0x10A9}, {"QUALCOMM", 0x05c6}, {"OTGV", 0x2257}, {"NEC", 0x0409},
            {"PMC", 0x04DA}, {"TOSHIBA", 0x0930}, {"SK_TELESYS", 0x1F53}, {"KT_TECH", 0x2116}, {"ASUS", 0x0b05},
            {"PHILIPS", 0x0471}, {"TI", 0x0451}, {"FUNAI", 0x0F1C}, {"GIGABYTE", 0x0414}, {"IRIVER", 0x2420},
            {"COMPAL", 0x1219}, {"T_AND_A", 0x1BBB}, {"LENOVOMOBILE", 0x2006}, {"LENOVO", 0x17EF}, {"VIZIO", 0xE040},
            {"K_TOUCH", 0x24E3}, {"PEGATRON", 0x1D4D}, {"ARCHOS", 0x0E79}, {"POSITIVO", 0x1662}, {"FUJITSU", 0x04C5},
            {"LUMIGON", 0x25E3}, {"QUANTA", 0x0408}, {"INQ_MOBILE", 0x2314}, {"SONY", 0x054C}, {"LAB126", 0x1949},
            {"YULONG_COOLPAD", 0x1EBF}, {"KOBO", 0x2237}, {"TELEEPOCH", 0x2340}, {"ANYDATA", 0x16D5},
            {"HARRIS", 0x19A5}, {"OPPO", 0x22D9}, {"XIAOMI", 0x2717}, {"BYD", 0x19D1}, {"OUYA", 0x2836},
            {"HAIER", 0x201E}, {"HISENSE", 0x109b}, {"MTK", 0x0e8d}, {"NOOK", 0x2080}, {"QISDA", 0x1D45},
            {"ECS", 0x03fc}, {"GENERIC", 0x1908},
        };
        for (Object[] id : ids) USB_VENDOR_IDS.put("VENDOR_ID_" + id[0], (Integer) id[1]);
    }
}
