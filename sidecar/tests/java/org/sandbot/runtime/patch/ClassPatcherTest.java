package org.sandbot.runtime.patch;

import org.sandbot.runtime.TestSim;
import org.sandbot.sim.SimExit;
import org.sandbot.sim.TimeRedirects;
import org.sandbot.testing.Check;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.invoke.MethodType;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.tools.FileObject;
import javax.tools.ForwardingJavaFileManager;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * ClassPatcher(spec §2.3): 대상 표의 모든 항목(정적·인스턴스·인터페이스 수신·메서드 참조·람다·생성자·정적 초기화·하위 클래스),
 * 패치한 클래스가 검증기를 통과하는지(정의·초기화·실행), 바꾸지 말아야 할 호출이 그대로인지.
 */
public final class ClassPatcherTest {
    private static final String TARGETS = "org.sandbot.runtime.patchtargets.Targets";
    private static final long MS = 1_000_000L;
    /** 기다리는 함수의 진입 비용과 시계 읽기 비용(HubTiming 기본 clockRead 0.001 ms) */
    private static final long CLOCK_READ = 1_000L;

    private ClassPatcherTest() {}

    // ---- 도움 ----

    static byte[] resource(ClassLoader loader, String binaryName) throws IOException {
        try (InputStream in = loader.getResourceAsStream(binaryName.replace('.', '/') + ".class")) {
            if (in == null) throw new IOException("no class file for " + binaryName);
            return in.readAllBytes();
        }
    }

    /** patchtargets 패키지의 클래스를 패치해 자식 먼저 정의하는 로더 */
    static final class PatchingLoader extends ClassLoader {
        final Map<String, ClassPatcher.Result> results = new HashMap<>();
        private final ClassPatcher patcher;

        PatchingLoader(ClassLoader parent) {
            super(parent);
            patcher = new ClassPatcher(ClassHierarchy.ofClassLoader(parent));
        }

        @Override
        protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
            if (!name.startsWith("org.sandbot.runtime.patchtargets.")) return super.loadClass(name, resolve);
            synchronized (getClassLoadingLock(name)) {
                Class<?> c = findLoadedClass(name);
                if (c == null) {
                    try {
                        ClassPatcher.Result r = patcher.apply(resource(getParent(), name));
                        results.put(name, r);
                        c = defineClass(name, r.bytes, 0, r.bytes.length);
                    } catch (IOException | PatchException e) {
                        throw new ClassNotFoundException(name, e);
                    }
                }
                if (resolve) resolveClass(c);
                return c;
            }
        }
    }

    private static PatchingLoader loader;
    private static Class<?> targets;

    /** 패치한 Targets(정적 초기화 전) */
    private static synchronized Class<?> targets() throws Exception {
        if (targets == null) {
            loader = new PatchingLoader(ClassPatcherTest.class.getClassLoader());
            targets = Class.forName(TARGETS, false, loader);
        }
        return targets;
    }

    private static Object call(String method, Object... args) throws Throwable {
        Class<?> type = targets();
        Method m = null;
        for (Method candidate : type.getMethods()) {
            if (candidate.getName().equals(method) && candidate.getParameterCount() == args.length) m = candidate;
        }
        if (m == null) throw new AssertionError("no method " + method);
        try {
            return m.invoke(Modifier.isStatic(m.getModifiers()) ? null : type.getConstructor().newInstance(), args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    /** 부르는 동안 흐른 가상 시간 */
    private static long elapsed(String method, Object... args) throws Throwable {
        TestSim.reset();
        long before = TestSim.nanos();
        call(method, args);
        return TestSim.nanos() - before;
    }

    /** 클래스 파일의 invoke 명령 목록("invokestatic owner.name(desc)") */
    static List<String> invokes(byte[] bytes) throws PatchException {
        ClassFile cf = new ClassFile(bytes);
        List<String> out = new ArrayList<>();
        String[] names = {"invokevirtual", "invokespecial", "invokestatic", "invokeinterface"};
        for (int[] range : cf.codeRanges) {
            int pc = range[0];
            while (pc < range[1]) {
                int op = bytes[pc] & 0xFF;
                if (op >= 0xB6 && op <= 0xB9) {
                    int index = cf.u2(pc + 1);
                    int off = cf.cpOffset[index];
                    String owner = cf.className(cf.u2(off + 1));
                    int nat = cf.cpOffset[cf.u2(off + 3)];
                    out.add(names[op - 0xB6] + " " + owner + "." + cf.utf8(cf.u2(nat + 1)) + cf.utf8(cf.u2(nat + 3)));
                }
                pc += ClassPatcher.instructionLength(bytes, pc, range[0]);
            }
        }
        return out;
    }

    // ---- 대상 표 ----

    public static void testEveryTargetHasARedirectMethod() throws Exception {
        for (ClassPatcher.Target t : ClassPatcher.TARGETS) {
            boolean found = false;
            for (Method m : TimeRedirects.class.getMethods()) {
                String desc = MethodType.methodType(m.getReturnType(), m.getParameterTypes()).toMethodDescriptorString();
                if (m.getName().equals(t.newName) && desc.equals(t.newDesc) && Modifier.isStatic(m.getModifiers()))
                    found = true;
            }
            Check.isTrue(found, "TimeRedirects." + t.newName + t.newDesc + " for " + t);
        }
        Check.isTrue(ClassPatcher.TARGETS.size() >= 25, "target count");
    }

    public static void testPatchedClassPassesVerifier() throws Throwable {
        TestSim.reset();
        Class<?> type = targets();
        // 초기화(검증·링크 포함)와 중첩 클래스 모두
        Class.forName(TARGETS, true, loader);
        for (String nested : new String[] {"$Worker", "$Hider", "$Joiner", "$Subclass", "$LockableImpl"}) {
            Class.forName(TARGETS + nested, true, loader);
        }
        Check.isTrue(type.getClassLoader() == loader, "patched copy is used");
        Check.isTrue(loader.results.get(TARGETS).changed(), "Targets was patched");
    }

    public static void testStaticInitializerAndConstructor() throws Throwable {
        TestSim.reset();
        long t0 = TestSim.nanos();
        Class<?> type = targets();
        Class.forName(TARGETS, true, loader);
        long staticInit = type.getField("STATIC_INIT_NANOS").getLong(null);
        // 처음 초기화면 지금 시계, 앞 테스트가 이미 초기화했으면 그 시계의 값(어느 쪽이든 가상 값이라 작다)
        Check.isTrue(staticInit >= 0 && staticInit < 10_000 * MS, "static initializer sees virtual time: " + staticInit);
        Object instance = type.getConstructor().newInstance();
        long constructed = type.getField("constructedNanos").getLong(instance);
        Check.equal(t0 + 7 * MS + 2 * CLOCK_READ, constructed, "constructor sleep(7) + nanoTime");
    }

    public static void testSystemClockReads() throws Throwable {
        TestSim.reset();
        Check.equal(CLOCK_READ, call("nanoTime"), "nanoTime is virtual (after its own clock read cost)");
        TestSim.reset();
        Check.equal(TestSim.START_EPOCH, call("currentTimeMillis"), "currentTimeMillis");
        TestSim.reset();
        Check.equal(CLOCK_READ, call("methodRefNanoTime"), "System::nanoTime method reference");
    }

    public static void testThreadSleep() throws Throwable {
        Check.equal(100 * MS + CLOCK_READ, elapsed("threadSleep", 100L), "Thread.sleep(long)");
        Check.equal(20 * MS + 500_000 + CLOCK_READ, elapsed("threadSleepNanos", 20L, 500_000), "Thread.sleep(long, int)");
        Check.equal(3 * MS + CLOCK_READ, elapsed("sleepThroughInstance"), "static sleep through an instance");
        Check.equal(11 * MS + CLOCK_READ, elapsed("methodRefSleep"), "Thread::sleep method reference");
        Check.equal(14 * MS + CLOCK_READ, elapsed("lambdaSleep"), "sleep inside a lambda");
        Check.equal(15 * MS + CLOCK_READ, elapsed("workerSleep"), "Worker.sleep (Thread subclass)");
        Check.throwsType(IllegalArgumentException.class, () -> call("threadSleep", -1L), "negative sleep");
        Check.throwsType(IllegalArgumentException.class, () -> call("threadSleepNanos", 1L, 1_000_000), "bad nanos");
    }

    public static void testSleepInterruptSemantics() throws Throwable {
        TestSim.reset();
        Thread.currentThread().interrupt();
        Check.throwsType(InterruptedException.class, () -> call("threadSleep", 10L), "interrupted before sleep");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "flag cleared");
        // 기다리는 중 틱 경계에서 끼어들기
        TestSim.reset();
        TestSim.onTick = k -> {
            if (k == 3) Thread.currentThread().interrupt();
        };
        Check.throwsType(InterruptedException.class, () -> call("threadSleep", 100L), "interrupted while sleeping");
        Check.equal(3 * TestSim.TICK, TestSim.nanos(), "woke at the boundary that interrupted");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "flag cleared");
    }

    public static void testTimeUnitSleep() throws Throwable {
        Check.equal(12 * MS + CLOCK_READ, elapsed("timeUnitSleep"), "TimeUnit.sleep");
        Check.equal(0L, elapsed("timeUnitSleepZero"), "TimeUnit.sleep(0) does nothing");
    }

    public static void testObjectWaitOnAnyReceiver() throws Throwable {
        Check.equal(100 * MS + CLOCK_READ, elapsed("objectWait", new Object(), 100L), "Object.wait(long)");
        Check.equal(31 * MS + CLOCK_READ, elapsed("objectWaitNanos", new Object(), 30L, 1), "Object.wait(long, int)");
        TestSim.reset();
        long before = TestSim.nanos();
        Class<?> type = targets();
        Object instance = type.getConstructor().newInstance();
        before = TestSim.nanos();
        type.getMethod("thisWait").invoke(instance);
        Check.equal(5 * MS + CLOCK_READ, TestSim.nanos() - before, "this.wait (owner = own class)");
        Object lockable = Class.forName(TARGETS + "$LockableImpl", true, loader).getConstructor().newInstance();
        Check.equal(6 * MS + CLOCK_READ, elapsed("interfaceWait", lockable), "wait on an interface-typed receiver");
        Check.equal(4 * MS + CLOCK_READ, elapsed("arrayWait", new int[1]), "wait on an array");
        Check.equal(8 * MS + CLOCK_READ, elapsed("boundMethodRefWait", new Object()), "lock::wait method reference");
        Object sub = Class.forName(TARGETS + "$Subclass", true, loader).getConstructor().newInstance();
        before = TestSim.nanos();
        sub.getClass().getMethod("superWait").invoke(sub);
        Check.equal(2 * MS + CLOCK_READ, TestSim.nanos() - before, "super.wait (invokespecial)");
        Check.throwsType(IllegalMonitorStateException.class, () -> call("waitWithoutMonitor", new Object()),
                "wait without the monitor");
    }

    public static void testThreadJoin() throws Throwable {
        Check.equal(0L, elapsed("joinNotStarted"), "join on a thread that never started returns at once");
        Check.equal(0L, elapsed("joinWorkerNotStarted"), "join through a Thread subclass");
        Check.equal(9 * MS + CLOCK_READ, elapsed("joinSelf"), "join(self, 9) waits");
        Check.equal(10 * MS + CLOCK_READ, elapsed("joinSelfNanos"), "join(self, 9, 5) waits 10 ms like the JDK");
        Check.equal(13 * MS + CLOCK_READ, elapsed("unboundMethodRefJoin"), "Thread::join method reference");
    }

    public static void testLockSupport() throws Throwable {
        Check.equal(3 * MS + CLOCK_READ, elapsed("parkNanos"), "parkNanos(long)");
        Check.equal(3 * MS + CLOCK_READ, elapsed("parkNanosBlocker"), "parkNanos(Object, long)");
        Check.equal(25 * MS + CLOCK_READ, elapsed("parkUntil", TestSim.START_EPOCH + 25), "parkUntil(long)");
        Check.equal(25 * MS + CLOCK_READ, elapsed("parkUntilBlocker", TestSim.START_EPOCH + 25), "parkUntil(Object, long)");
        // park는 끼어들기에 예외 없이 돌아오고 플래그를 남긴다
        TestSim.reset();
        Thread.currentThread().interrupt();
        call("parkNanos");
        Check.isTrue(Thread.interrupted(), "park keeps the interrupt flag");
        Check.equal(CLOCK_READ, TestSim.nanos(), "park returned at once when interrupted");
    }

    public static void testJavaTime() throws Throwable {
        TestSim.reset();
        TestSim.onTick = null;
        Instant now = (Instant) call("instantNow");
        Check.equal(Instant.ofEpochMilli(TestSim.START_EPOCH).plusNanos(CLOCK_READ), now, "Instant.now()");
        java.time.Clock utc = (java.time.Clock) call("clockUTC");
        Check.equal(ZoneOffset.UTC, utc.getZone(), "Clock.systemUTC zone");
        long before = TestSim.nanos();
        Check.equal(TestSim.START_EPOCH + (before + CLOCK_READ) / MS, utc.millis(), "clock follows the virtual time");
        java.time.Clock local = (java.time.Clock) call("clockDefaultZone");
        Check.equal(java.time.ZoneId.systemDefault(), local.getZone(), "Clock.systemDefaultZone zone");
        TestSim.reset();
        LocalDateTime ldt = (LocalDateTime) call("localDateTimeNow");
        Check.equal(LocalDateTime.ofInstant(Instant.ofEpochMilli(TestSim.START_EPOCH).plusNanos(CLOCK_READ),
                java.time.ZoneId.systemDefault()), ldt, "LocalDateTime.now (virtual epoch 2023-11-14)");
        Check.equal(ldt.toLocalDate(), call("localDateNow"), "LocalDate.now");
        Check.isTrue(call("localTimeNow") != null, "LocalTime.now");
        Check.equal(Instant.ofEpochMilli(TestSim.START_EPOCH).plusNanos(4 * CLOCK_READ),
                ((java.time.ZonedDateTime) call("zonedDateTimeNow")).toInstant(), "ZonedDateTime.now");
        Check.isTrue(call("offsetDateTimeNow") != null, "OffsetDateTime.now");
    }

    public static void testExitBecomesSimExit() throws Throwable {
        TestSim.reset();
        SimExit e = Check.throwsType(SimExit.class, () -> call("exit"), "System.exit");
        Check.equal(5, e.status(), "status");
        Check.equal(6, Check.throwsType(SimExit.class, () -> call("runtimeExit"), "Runtime.exit").status(), "status");
        Check.equal(7, Check.throwsType(SimExit.class, () -> call("runtimeHalt"), "Runtime.halt").status(), "status");
    }

    public static void testLookalikesAreUntouched() throws Throwable {
        TestSim.reset();
        Check.equal(Boolean.TRUE, call("hiderSleep"), "a subclass's own static sleep(long) still runs");
        Check.equal(0L, TestSim.nanos(), "and takes no virtual time");
        Check.equal(17L, call("unrelatedJoin"), "join(long) of a non-Thread class still runs");
        targets();
        List<String> calls = invokes(loader.results.get(TARGETS).bytes);
        for (String expected : new String[] {
            "invokestatic java/lang/Thread.currentThread()Ljava/lang/Thread;",
            "invokestatic java/lang/System.identityHashCode(Ljava/lang/Object;)I",
            "invokestatic java/time/Instant.ofEpochMilli(J)Ljava/time/Instant;",
            "invokestatic java/time/Instant.now(Ljava/time/Clock;)Ljava/time/Instant;",
            "invokestatic java/lang/System.getProperty(Ljava/lang/String;)Ljava/lang/String;",
            "invokevirtual java/util/concurrent/TimeUnit.toNanos(J)J",
            "invokevirtual java/lang/Object.wait()V",
            "invokevirtual java/lang/Object.notifyAll()V",
            "invokevirtual java/lang/Thread.join()V",
            "invokestatic org/sandbot/runtime/patchtargets/Targets$Hider.sleep(J)V",
            "invokevirtual org/sandbot/runtime/patchtargets/Targets$Joiner.join(J)V"
        }) {
            Check.isTrue(calls.contains(expected), "kept: " + expected + " in " + calls);
        }
        for (String call : calls) {
            Check.isTrue(!call.startsWith("invokestatic java/lang/System.nanoTime"), "no real nanoTime left: " + call);
            Check.isTrue(!call.equals("invokestatic java/lang/Thread.sleep(J)V"), "no real sleep left");
            Check.isTrue(!call.endsWith(".wait(J)V") || call.startsWith("invokestatic org/sandbot/sim/TimeRedirects"),
                    "no real wait(long) left: " + call);
        }
        Check.isTrue(calls.contains("invokestatic org/sandbot/sim/TimeRedirects.wait(Ljava/lang/Object;J)V"),
                "wait redirected");
    }

    public static void testUnchangedClassIsSameArray() throws Exception {
        byte[] bytes = resource(ClassPatcherTest.class.getClassLoader(), TARGETS + "$Joiner");
        Check.isTrue(ClassPatcher.patch(bytes) == bytes, "nothing to patch returns the same array");
        byte[] sim = resource(ClassPatcherTest.class.getClassLoader(), "org.sandbot.sim.TimeRedirects");
        Check.isTrue(ClassPatcher.patch(sim) == sim, "org.sandbot.sim classes are never patched");
    }

    public static void testBadClassFiles() {
        Check.throwsType(PatchException.class, () -> ClassPatcher.patch(new byte[] {1, 2, 3, 4, 5, 6, 7, 8, 9, 10}),
                "bad magic");
        byte[] future = {(byte) 0xCA, (byte) 0xFE, (byte) 0xBA, (byte) 0xBE, 0, 0, 0, (byte) 200, 0, 1};
        Check.throwsType(PatchException.class, () -> ClassPatcher.patch(future), "class file version too new");
    }

    /** 상수 풀 항목 수(constant_pool_count)가 cpCount인 클래스: System.nanoTime Methodref 하나 + 채움 Utf8 */
    static byte[] syntheticClass(int cpCount) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        java.io.DataOutputStream out = new java.io.DataOutputStream(bytes);
        out.writeInt(0xCAFEBABE);
        out.writeShort(0);
        out.writeShort(52);
        out.writeShort(cpCount);
        out.writeByte(1);
        out.writeUTF("Big"); // 1
        out.writeByte(7);
        out.writeShort(1); // 2 Class Big
        out.writeByte(1);
        out.writeUTF("java/lang/Object"); // 3
        out.writeByte(7);
        out.writeShort(3); // 4
        out.writeByte(1);
        out.writeUTF("java/lang/System"); // 5
        out.writeByte(7);
        out.writeShort(5); // 6
        out.writeByte(1);
        out.writeUTF("nanoTime"); // 7
        out.writeByte(1);
        out.writeUTF("()J"); // 8
        out.writeByte(12);
        out.writeShort(7);
        out.writeShort(8); // 9
        out.writeByte(10);
        out.writeShort(6);
        out.writeShort(9); // 10 Methodref System.nanoTime
        for (int i = 11; i < cpCount; i++) {
            out.writeByte(1);
            out.writeUTF("f" + i);
        }
        out.writeShort(0x21);
        out.writeShort(2);
        out.writeShort(4);
        out.writeShort(0);
        out.writeShort(0);
        out.writeShort(0);
        out.writeShort(0);
        return bytes.toByteArray();
    }

    public static void testConstantPoolOverflowIsReported() throws Exception {
        // 패치는 이 클래스에 항목 5개(TimeRedirects Utf8·Class, nanoTime·()J Utf8, NameAndType)를 더한다
        byte[] fits = syntheticClass(0xFFFF - 5);
        byte[] patched = ClassPatcher.patch(fits);
        Check.equal(0xFFFF, new ClassFile(patched).cpCount, "patched up to the limit");
        Check.isTrue(invokesNothing(patched), "parses");
        byte[] tooBig = syntheticClass(0xFFFF - 4);
        PatchException e = Check.throwsType(PatchException.class, () -> ClassPatcher.patch(tooBig), "overflow");
        Check.isTrue(e.getMessage().contains("65535"), e.getMessage());
    }

    private static boolean invokesNothing(byte[] bytes) throws PatchException {
        return invokes(bytes).isEmpty();
    }

    public static void testThreadSleepDurationOnNewerJdks() throws Throwable {
        int feature = Runtime.version().feature();
        if (feature < 19) return;
        String src = "public class DurationSleep { public static void run() throws InterruptedException {"
                + " Thread.sleep(java.time.Duration.ofMillis(21)); } }";
        Map<String, byte[]> out = compile(Collections.singletonMap("DurationSleep", src), String.valueOf(feature));
        byte[] patched = ClassPatcher.patch(out.get("DurationSleep"));
        Check.isTrue(invokes(patched).contains("invokestatic org/sandbot/sim/TimeRedirects.sleep(Ljava/time/Duration;)V"),
                "Thread.sleep(Duration) redirected");
        Class<?> type = new ClassLoader(ClassPatcherTest.class.getClassLoader()) {
            Class<?> define() {
                return defineClass("DurationSleep", patched, 0, patched.length);
            }
        }.define();
        TestSim.reset();
        type.getMethod("run").invoke(null);
        Check.equal(21 * MS + CLOCK_READ, TestSim.nanos(), "Thread.sleep(Duration) is virtual");
    }

    public static void testTeamStyleRelease8Code() throws Throwable {
        // 팀 코드처럼 --release 8로 컴파일한 것(인터페이스 수신 wait, Thread 하위 클래스의 sleep)도 같다
        String src = "public class Release8 extends Thread {"
                + " public interface L {}"
                + " public static void run(L l) throws InterruptedException {"
                + "  synchronized (l) { l.wait(3); }"
                + "  sleep(4);"
                + "  java.util.function.LongSupplier s = System::currentTimeMillis; s.getAsLong();"
                + " } }";
        Map<String, byte[]> out = compile(Collections.singletonMap("Release8", src), "8");
        Map<String, byte[]> internal = new HashMap<>();
        for (Map.Entry<String, byte[]> e : out.entrySet()) internal.put(e.getKey().replace('.', '/'), e.getValue());
        ClassPatcher patcher = new ClassPatcher(ClassHierarchy.chain(ClassHierarchy.ofClassFiles(internal),
                ClassHierarchy.ofClassLoader(ClassPatcherTest.class.getClassLoader())));
        Map<String, byte[]> patched = new HashMap<>();
        for (Map.Entry<String, byte[]> e : out.entrySet()) patched.put(e.getKey(), patcher.apply(e.getValue()).bytes);
        ClassLoader l = new ClassLoader(ClassPatcherTest.class.getClassLoader()) {
            @Override
            protected Class<?> findClass(String name) throws ClassNotFoundException {
                byte[] b = patched.get(name);
                if (b == null) throw new ClassNotFoundException(name);
                return defineClass(name, b, 0, b.length);
            }
        };
        Class<?> type = Class.forName("Release8", true, l);
        Class<?> iface = Class.forName("Release8$L", true, l);
        Object lockable = java.lang.reflect.Proxy.newProxyInstance(l, new Class<?>[] {iface}, (p, m, a) -> null);
        TestSim.reset();
        type.getMethod("run", iface).invoke(null, lockable);
        Check.equal(7 * MS + 3 * CLOCK_READ, TestSim.nanos(), "release 8 code is virtual");
    }

    public static void testPatchToolCopiesTree() throws Exception {
        Path in = Files.createTempDirectory("sandbot-patch-in");
        Path out = Files.createTempDirectory("sandbot-patch-out");
        ClassLoader cl = ClassPatcherTest.class.getClassLoader();
        Path classFile = in.resolve("org/sandbot/runtime/patchtargets/Targets.class");
        Files.createDirectories(classFile.getParent());
        Files.write(classFile, resource(cl, TARGETS));
        Files.write(in.resolve("org/sandbot/runtime/patchtargets/Targets$Joiner.class"), resource(cl, TARGETS + "$Joiner"));
        Files.write(in.resolve("readme.txt"), "hello".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Files.write(in.resolve("Broken.class"), new byte[] {1, 2, 3});
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        int code = PatchTool.run(new String[] {"--verbose", in.toString(), out.toString()},
                new java.io.PrintStream(stdout, true, "UTF-8"), new java.io.PrintStream(stderr, true, "UTF-8"));
        String text = stdout.toString("UTF-8");
        Check.equal(1, code, "a failed class gives exit code 1: " + text + stderr);
        Check.isTrue(text.contains("PATCHED org/sandbot/runtime/patchtargets/Targets.class ")
                && text.contains("java.lang.System.nanoTime()J"), text);
        Check.isTrue(text.contains("FAILED Broken.class: "), text);
        Check.isTrue(text.contains("SUMMARY classes=3 patched=1 unchanged=1 failed=1 copied=1"), text);
        Check.isTrue(!Files.exists(out.resolve("Broken.class")), "failed class is not written");
        Check.equal("hello", new String(Files.readAllBytes(out.resolve("readme.txt")), "UTF-8"), "other files copied");
        byte[] joiner = Files.readAllBytes(out.resolve("org/sandbot/runtime/patchtargets/Targets$Joiner.class"));
        Check.isTrue(Arrays.equals(resource(cl, TARGETS + "$Joiner"), joiner), "unchanged class copied as is");
        Check.isTrue(!Arrays.equals(resource(cl, TARGETS), Files.readAllBytes(out.resolve("org/sandbot/runtime/patchtargets/Targets.class"))),
                "patched class written");
        Check.equal(2, PatchTool.run(new String[] {in.toString()}, new java.io.PrintStream(stdout), new java.io.PrintStream(stderr)),
                "usage error");
    }

    // ---- 메모리 컴파일(테스트용) ----

    static Map<String, byte[]> compile(Map<String, String> sources, String release) throws IOException {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        StandardJavaFileManager standard = compiler.getStandardFileManager(null, null, null);
        Map<String, byte[]> out = new HashMap<>();
        List<JavaFileObject> units = new ArrayList<>();
        for (Map.Entry<String, String> e : sources.entrySet()) {
            units.add(new SimpleJavaFileObject(URI.create("string:///" + e.getKey() + ".java"), JavaFileObject.Kind.SOURCE) {
                @Override
                public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                    return e.getValue();
                }
            });
        }
        ForwardingJavaFileManager<StandardJavaFileManager> files = new ForwardingJavaFileManager<StandardJavaFileManager>(standard) {
            @Override
            public JavaFileObject getJavaFileForOutput(Location location, String className, JavaFileObject.Kind kind,
                    FileObject sibling) {
                return new SimpleJavaFileObject(URI.create("mem:///" + className + ".class"), kind) {
                    @Override
                    public OutputStream openOutputStream() {
                        return new ByteArrayOutputStream() {
                            @Override
                            public void close() throws IOException {
                                super.close();
                                out.put(className, toByteArray());
                            }
                        };
                    }
                };
            }
        };
        List<String> options = Arrays.asList("--release", release, "-Xlint:-options", "-nowarn");
        Boolean ok = compiler.getTask(null, files, null, options, null, units).call();
        if (!ok) throw new IOException("test source failed to compile");
        return out;
    }
}
