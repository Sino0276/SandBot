package org.sandbot.tools;

import com.sun.source.util.JavacTask;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;

/**
 * 가짜 SDK 빌드의 Java 쪽(scripts/build-sidecar.mjs가 부른다). JVM 하나에서 차례로 한다:
 *
 * <ol>
 *   <li>sim + 손 구현을 실제 SDK jar에 대고 미리 컴파일한다(들여오기가 손 구현의 멤버를 알아야 한다).
 *   <li>들여오기(Lifter): 닫힌 실제 클래스 묶음을 고른다.
 *   <li>stub 생성(StubGen): 나머지 실제 클래스의 public·protected API와 불투명 껍데기.
 *   <li>sim + 손 구현 + stub을 들여온 클래스에 대고 컴파일(--release 8).
 *   <li>runtime 컴파일(--release 17).
 *   <li>들여온 클래스 패치(R의 org.sandbot.runtime.patch.PatchTool, 따로 JVM) → 링크 확인.
 *   <li>API 대조(손 구현, 그리고 stub이 실제와 같은지), 반드시 있어야 할 클래스 확인.
 *   <li>sandbot-sdk.jar·sandbot-runtime.jar와 보고(JSON).
 * </ol>
 *
 * 실패하면 종료 코드 1. --allow-missing이면 아직 없는 것(반드시 있어야 할 클래스가 stub, runtime Main·PatchTool 없음)을
 * 경고로 낮추고 보고의 incomplete에 적는다.
 */
public final class SdkBuild {
    private final Map<String, String> options = new LinkedHashMap<>();
    private final boolean allowMissing;
    private final List<String> warnings = new ArrayList<>();
    private final List<String> errors = new ArrayList<>();
    private final List<String> incomplete = new ArrayList<>();
    private final Map<String, Object> report = new LinkedHashMap<>();
    private final long started = System.nanoTime();

    private SdkBuild(String[] args) {
        boolean allow = false;
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--allow-missing")) allow = true;
            else options.put(args[i], args[++i]);
        }
        allowMissing = allow;
    }

    public static void main(String[] args) throws Exception {
        SdkBuild build = new SdkBuild(args);
        boolean ok;
        try {
            ok = build.run();
        } catch (BuildFailure failure) {
            build.errors.add(failure.getMessage());
            ok = false;
        }
        build.finish(ok);
        System.exit(ok ? 0 : 1);
    }

    private static final class BuildFailure extends Exception {
        private static final long serialVersionUID = 1L;

        BuildFailure(String message) {
            super(message);
        }
    }

    private Path path(String option) {
        String value = options.get(option);
        if (value == null) throw new IllegalArgumentException("missing option " + option);
        return Paths.get(value).toAbsolutePath();
    }

    private void step(String what) {
        System.out.printf(Locale.ROOT, "[%5.1fs] %s%n", (System.nanoTime() - started) / 1e9, what);
        System.out.flush();
    }

    private boolean run() throws Exception {
        Path work = path("--work");
        deleteTree(work);
        Path handPre = work.resolve("hand-pre");
        Path stubs = work.resolve("stubs");
        Path liftedRaw = work.resolve("lifted-raw");
        Path lifted = work.resolve("lifted");
        Path classesSdk = work.resolve("classes-sdk");
        Path classesRuntime = work.resolve("classes-runtime");
        for (Path p : Arrays.asList(handPre, stubs, liftedRaw, lifted, classesSdk, classesRuntime))
            Files.createDirectories(p);

        List<Path> realJars = new ArrayList<>();
        for (String p : options.get("--real").split(File.pathSeparator)) realJars.add(Paths.get(p).toAbsolutePath());
        Path androidJar = path("--android");
        List<Path> simSources = javaFiles(path("--sim"));
        List<Path> handSources = javaFiles(path("--sdk"));
        List<Path> runtimeSources = javaFiles(path("--runtime"));
        report.put("handSourceFiles", handSources.size());
        report.put("runtimeSourceFiles", runtimeSources.size());

        // 0. 실제 SDK의 API가 부르지만 어디에도 없는 형식(OpenCV, threeten, API 16에 없는 안드로이드 형식 …)의 불투명 껍데기.
        //    손 구현도 실제 API를 그대로 따르므로 이 형식을 쓴다: 미리 만들어 두 컴파일에 같이 넣는다. 손 구현이 만든 형식은 뺀다.
        step("collect types missing from the SDK's dependencies");
        Path missingDir = work.resolve("missing");
        Set<String> handTops = new TreeSet<>();
        Path sdkRoot = path("--sdk");
        for (Path file : handSources) {
            String rel = sdkRoot.relativize(file).toString().replace(File.separatorChar, '/');
            handTops.add(rel.substring(0, rel.length() - ".java".length()));
        }
        List<ClassSource> realSources = new ArrayList<>();
        for (Path jar : realJars) realSources.add(ClassSource.jar(jar));
        ClassSource real = ClassSource.chain(realSources);
        ClassSource android = ClassSource.jar(androidJar);
        Set<String> allRealNests = new TreeSet<>();
        {
            Lifter nests = new Lifter(ClassSource.directory(handPre), real, ClassSource.jdk());
            for (String name : real.names()) allRealNests.add(nests.nest(real, name));
        }
        int missingCount = generateStubs(real, android, Collections.<Path>emptyList(), allRealNests,
                Collections.<String>emptySet(), Collections.<String>emptySet(), missingDir, false,
                (top, inAndroid) -> !inAndroid && !handTops.contains(top));
        Set<String> missingTops = new TreeSet<>();
        for (Path file : javaFiles(missingDir)) {
            String rel = missingDir.relativize(file).toString().replace(File.separatorChar, '/');
            missingTops.add(rel.substring(0, rel.length() - ".java".length()));
        }
        report.put("missingTypes", missingTops.stream().map(ApiCheck::dotted).collect(Collectors.toList()));

        // 1. sim + 손 구현을 실제 SDK에 대고(들여오기 분석용)
        step("compile sim + " + handSources.size() + " hand sources against the real SDK (+" + missingCount
                + " missing types)");
        List<Path> pre = new ArrayList<>(simSources);
        pre.addAll(handSources);
        pre.addAll(javaFiles(missingDir));
        List<Path> preClasspath = new ArrayList<>(realJars);
        preClasspath.add(androidJar);
        if (!compile(pre, preClasspath, handPre, "8", "hand sources (against the real SDK)")) return false;

        // 2. 들여오기
        step("lift");
        // 미리 만든 불투명 형식은 손 구현이 아니다(들여온 클래스가 쓰면 막힌다)
        ClassSource hand = withoutNames(ClassSource.directory(handPre), missingTops);
        ClassSource jdk = ClassSource.jdk();
        Lifter lifter = new Lifter(hand, real, jdk);
        lifter.run();
        List<String> liftedNames = lifter.liftedClasses();
        for (String name : liftedNames) {
            Path file = liftedRaw.resolve(name + ".class");
            Files.createDirectories(file.getParent());
            Files.write(file, real.bytes(name));
        }
        Set<String> stubNests = new TreeSet<>(lifter.candidates.keySet());
        stubNests.removeAll(lifter.lifted);

        // 3. stub
        step("generate stubs");
        Set<String> provided = new TreeSet<>(hand.names());
        provided.addAll(liftedNames);
        Set<String> extraOpaque = new TreeSet<>();
        for (String name : hand.names()) {
            for (String dep : hand.get(name).dependencies) {
                if (hand.has(dep) || jdk.has(dep)) continue;
                if (real.has(dep) && !lifter.handNests().contains(lifter.nest(real, dep))) continue;
                if (real.has(dep)) continue; // 손 구현 묶음이 빠뜨린 중첩 클래스: 컴파일이 알린다
                extraOpaque.add(dep);
            }
        }
        int stubCount = generateStubs(real, android, Collections.singletonList(handPre), stubNests, provided,
                extraOpaque, stubs, true, (top, inAndroid) -> !missingTops.contains(top));
        int opaqueCount = lastOpaqueCount + missingTops.size();

        // 4. 최종 sdk 컴파일
        step("compile sim + hand + " + stubCount + " stubs + " + opaqueCount + " opaque (--release 8)");
        List<Path> all = new ArrayList<>(simSources);
        all.addAll(handSources);
        all.addAll(javaFiles(stubs));
        all.addAll(javaFiles(missingDir));
        if (!compile(all, Collections.singletonList(liftedRaw), classesSdk, "8", "SDK (sim + hand + stubs)"))
            return false;
        copyResources(path("--sdk"), classesSdk);

        // 5. runtime
        Path hashResource = classesRuntime.resolve("org/sandbot/runtime/source-hash.txt");
        if (!runtimeSources.isEmpty()) {
            step("compile " + runtimeSources.size() + " runtime sources (--release 17)");
            if (!compile(runtimeSources, Arrays.asList(classesSdk, liftedRaw), classesRuntime, "17", "runtime"))
                return false;
            copyResources(path("--runtime"), classesRuntime);
        }
        Files.createDirectories(hashResource.getParent());
        Files.write(hashResource, (options.get("--source-hash") + "\n").getBytes(StandardCharsets.UTF_8));
        boolean hasMain = Files.exists(classesRuntime.resolve("org/sandbot/runtime/Main.class"));
        if (!hasMain) missing("sidecar/runtime has no org.sandbot.runtime.Main (the runtime jar cannot start)");

        // 6. 패치
        Path patchTool = classesRuntime.resolve("org/sandbot/runtime/patch/PatchTool.class");
        if (Files.exists(patchTool)) {
            step("patch " + liftedNames.size() + " lifted classes (org.sandbot.runtime.patch.PatchTool)");
            if (!patch(classesRuntime, classesSdk, liftedRaw, lifted)) return false;
        } else {
            missing("org.sandbot.runtime.patch.PatchTool is missing: lifted SDK classes are NOT patched "
                    + "(System.nanoTime, Thread.sleep and so on would use the real clock)");
            copyTree(liftedRaw, lifted);
        }
        step("link check");
        Set<String> liftedSet = new TreeSet<>(liftedNames);
        ClassSource liftedSource = ClassSource.directory(lifted);
        if (!new TreeSet<>(liftedSource.names()).equals(liftedSet))
            throw new BuildFailure("the patcher did not write exactly the lifted classes");
        ClassSource sdkClasses = ClassSource.directory(classesSdk);
        List<String> linkProblems = Lifter.linkCheck(liftedNames, liftedSource,
                ClassSource.chain(Arrays.asList(sdkClasses, liftedSource)), jdk);
        for (String p : linkProblems) errors.add("link: " + p);

        // 7. API 대조
        step("API check");
        Set<String> handNames = new TreeSet<>(hand.names());
        ApiCheck handCheck = new ApiCheck();
        // 가짜 SDK에 없는 형식(Gson 등)의 애너테이션은 손 구현이 쓸 수 없다
        ClassSource finalWorld = ClassSource.chain(Arrays.asList(sdkClasses, liftedSource, jdk));
        handCheck.annotationFilter = finalWorld::has;
        handCheck.checkHand(sdkClasses, handNames, real, android, lifter);
        for (String e : handCheck.errors) errors.add("api: " + e);
        for (String w : handCheck.warnings) warnings.add("api: " + w);
        ApiCheck stubCheck = new ApiCheck();
        stubCheck.annotationFilter = finalWorld::has;
        int stubClassFiles = 0;
        for (String name : sdkClasses.names()) {
            if (handNames.contains(name) || !stubNests.contains(lifter.nest(real, name)) || !real.has(name)) continue;
            stubClassFiles++;
            if (ApiCheck.visible(real, real.get(name))) stubCheck.compare(real.get(name), sdkClasses.get(name), true);
        }
        for (String name : real.names()) {
            if (stubNests.contains(lifter.nest(real, name)) && ApiCheck.visible(real, real.get(name))
                    && !sdkClasses.has(name)) stubCheck.errors.add(ApiCheck.dotted(name) + ": no stub was generated");
        }
        for (String e : stubCheck.errors) errors.add("stub differs from the real API: " + e);

        // 8. 반드시 있어야 할 클래스
        Map<String, String> mustProvide = new TreeMap<>();
        for (String line : Files.readAllLines(path("--must-provide"), StandardCharsets.UTF_8)) {
            String name = line.replaceAll("#.*", "").trim();
            if (name.isEmpty()) continue;
            String internal = name.replace('.', '/');
            String kind;
            if (!real.has(internal) && !hand.has(internal)) kind = "unknown";
            else if (hand.has(internal)) kind = "hand";
            else if (liftedSet.contains(internal)) kind = "lifted";
            else if (lifter.handNests().contains(lifter.nest(real, internal))) kind = "missing";
            else kind = "stub";
            mustProvide.put(name, kind);
            if (kind.equals("unknown")) errors.add("must-provide: " + name + " is not a class of the FTC SDK");
            else if (!kind.equals("hand") && !kind.equals("lifted")) {
                String reason = lifter.blockedReason.get(lifter.nest(real, internal));
                missing("must-provide: " + name + " is " + (kind.equals("stub") ? "only a stub" : "missing")
                        + (reason != null ? " (" + reason + ")" : ""));
            }
        }
        report.put("mustProvide", mustProvide);

        // 요약
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("handTopLevel", lifter.handNests().stream().filter(n -> !n.startsWith("org/sandbot/sim/")).count());
        counts.put("handClasses", handNames.stream().filter(n -> !n.startsWith("org/sandbot/sim/")).count());
        counts.put("liftedTopLevel", lifter.lifted.size());
        counts.put("liftedClasses", liftedNames.size());
        counts.put("stubTopLevel", stubCount);
        counts.put("stubClasses", stubClassFiles);
        counts.put("opaqueTopLevel", opaqueCount);
        counts.put("realTopLevel", lifter.candidates.size() + lifter.handNests().stream().filter(real::has).count());
        report.put("counts", counts);
        List<Map<String, Object>> blockers = new ArrayList<>();
        for (Lifter.Blocker b : lifter.topBlockers(20)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", ApiCheck.dotted(b.key));
            m.put("kind", b.isNest ? "sdk" : "external");
            m.put("unlocks", b.unlock);
            m.put("liftedAfter", b.total);
            if (b.isNest) m.put("reason", lifter.blockedReason.get(b.key));
            blockers.add(m);
        }
        report.put("topBlockers", blockers);
        report.put("lifted", lifter.lifted.stream().map(ApiCheck::dotted).collect(Collectors.toList()));
        report.put("hand", lifter.handNests().stream().map(ApiCheck::dotted).collect(Collectors.toList()));
        Map<String, String> blocked = new TreeMap<>();
        for (Map.Entry<String, String> e : lifter.blockedReason.entrySet())
            blocked.put(ApiCheck.dotted(e.getKey()), e.getValue());
        report.put("stubs", blocked);

        // 9. jar
        if (!errors.isEmpty()) return false;
        step("write jars");
        Path out = path("--out");
        Files.createDirectories(out);
        Map<String, Path> sdkFiles = Jars.collect(classesSdk, lifted);
        Jars.write(out.resolve("sandbot-sdk.jar"), sdkFiles, Collections.<String, byte[]>emptyMap(), null);
        Jars.write(out.resolve("sandbot-runtime.jar"), Jars.collect(classesRuntime),
                Collections.<String, byte[]>emptyMap(), hasMain ? "org.sandbot.runtime.Main" : null);

        return true;
    }

    private int lastOpaqueCount;

    /** javac 모델로 stub(과 불투명 껍데기)을 쓴다. 쓴 stub 최상위 수(writeStubs가 false면 불투명 껍데기 수)를 돌려준다. */
    private int generateStubs(ClassSource real, ClassSource android, List<Path> handClasses, Set<String> stubNests,
            Set<String> provided, Set<String> extraOpaque, Path out, boolean writeStubs,
            java.util.function.BiPredicate<String, Boolean> opaqueFilter) throws IOException, BuildFailure {
        JavaCompiler compiler = compiler();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(diagnostics, Locale.ENGLISH,
                StandardCharsets.UTF_8)) {
            List<Path> cp = new ArrayList<>(handClasses);
            for (String p : options.get("--real").split(File.pathSeparator)) cp.add(Paths.get(p));
            cp.add(path("--android"));
            fm.setLocationFromPaths(StandardLocation.CLASS_PATH, cp);
            JavacTask task = (JavacTask) compiler.getTask(null, fm, diagnostics,
                    Arrays.asList("--release", "8", "-proc:none"), null, Collections.<JavaFileObject>emptyList());
            StubGen gen = new StubGen(task.getElements(), task.getTypes(), stubNests, provided, real, android, out);
            int count = gen.run(extraOpaque, writeStubs, opaqueFilter);
            lastOpaqueCount = gen.opaqueCount();
            if (writeStubs) for (String w : gen.warnings) warnings.add("stub: " + w);
            return writeStubs ? count : lastOpaqueCount;
        }
    }

    /** 최상위 몇 개를 뺀 묶음 */
    private static ClassSource withoutNames(ClassSource source, Set<String> excluded) {
        return new ClassSource() {
            @Override
            List<String> names() {
                List<String> names = new ArrayList<>();
                for (String n : source.names()) if (!excluded.contains(topOf(n))) names.add(n);
                return names;
            }

            @Override
            byte[] bytes(String internalName) {
                return excluded.contains(topOf(internalName)) ? null : source.bytes(internalName);
            }
        };
    }

    private static String topOf(String internalName) {
        int dollar = internalName.indexOf('$');
        return dollar < 0 ? internalName : internalName.substring(0, dollar);
    }

    private void missing(String message) {
        if (allowMissing) {
            warnings.add(message);
            incomplete.add(message);
        } else {
            errors.add(message + " (pass --allow-missing to build anyway)");
        }
    }

    private void finish(boolean ok) throws IOException {
        report.put("ok", ok);
        report.put("seconds", Math.round((System.nanoTime() - started) / 1e8) / 10.0);
        report.put("incomplete", incomplete);
        report.put("warnings", warnings);
        report.put("errors", errors);
        String reportPath = options.get("--report");
        if (reportPath != null) {
            Path p = Paths.get(reportPath);
            Files.createDirectories(p.toAbsolutePath().getParent());
            Files.write(p, (Json.write(report) + "\n").getBytes(StandardCharsets.UTF_8));
        }
        for (String w : warnings) System.out.println("warning: " + w);
        int shown = 0;
        for (String e : errors) {
            if (shown++ == 200) {
                System.out.println("error: ... " + (errors.size() - 200) + " more errors");
                break;
            }
            System.out.println("error: " + e);
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> counts = (Map<String, Object>) report.get("counts");
        if (counts != null) {
            System.out.printf(Locale.ROOT, "hand %s, lifted %s (%s classes), stub %s, opaque %s%n",
                    counts.get("handTopLevel"), counts.get("liftedTopLevel"), counts.get("liftedClasses"),
                    counts.get("stubTopLevel"), counts.get("opaqueTopLevel"));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> blockers = (List<Map<String, Object>>) report.get("topBlockers");
            System.out.println("top lifting blockers (hand-implement in this order; unlocks = more top-level classes "
                    + "lifted, given the ones above):");
            for (Map<String, Object> b : blockers)
                System.out.printf(Locale.ROOT, "  %-72s +%-4s -> %s%n", b.get("name"), b.get("unlocks"),
                        b.get("liftedAfter"));
        }
        step(ok ? "done" : "FAILED");
    }

    // ---- 컴파일

    private static JavaCompiler compiler() throws BuildFailure {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new BuildFailure("this Java has no compiler (a JDK is needed, not a JRE)");
        return compiler;
    }

    private boolean compile(List<Path> sources, List<Path> classpath, Path out, String release, String what)
            throws IOException, BuildFailure {
        if (sources.isEmpty()) return true;
        JavaCompiler compiler = compiler();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(diagnostics, Locale.ENGLISH,
                StandardCharsets.UTF_8)) {
            fm.setLocationFromPaths(StandardLocation.CLASS_PATH, classpath);
            fm.setLocationFromPaths(StandardLocation.CLASS_OUTPUT, Collections.singletonList(out));
            fm.setLocationFromPaths(StandardLocation.SOURCE_PATH, Collections.<Path>emptyList());
            List<String> opts = new ArrayList<>(Arrays.asList("--release", release, "-g", "-encoding", "UTF-8",
                    "-proc:none", "-implicit:none", "-Xmaxerrs", "500", "-nowarn"));
            if (release.equals("8")) opts.add("-Xlint:-options");
            StringWriter output = new StringWriter();
            Boolean ok = compiler.getTask(output, fm, diagnostics, opts, null,
                    fm.getJavaFileObjectsFromPaths(sources)).call();
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                if (d.getKind() != Diagnostic.Kind.ERROR) continue;
                String file = d.getSource() == null ? "" : d.getSource().getName() + ":" + d.getLineNumber() + ": ";
                errors.add("javac (" + what + "): " + file + d.getMessage(Locale.ENGLISH));
            }
            if (!ok && errors.isEmpty()) errors.add("javac (" + what + ") failed: " + output);
            return ok;
        }
    }

    private boolean patch(Path runtime, Path sdk, Path in, Path out) throws IOException, InterruptedException {
        String java = options.getOrDefault("--java",
                Paths.get(System.getProperty("java.home"), "bin", "java").toString());
        String cp = String.join(File.pathSeparator, runtime.toString(), sdk.toString(), in.toString());
        ProcessBuilder pb = new ProcessBuilder(java, "-cp", cp, "org.sandbot.runtime.patch.PatchTool", in.toString(),
                out.toString());
        pb.redirectErrorStream(true);
        Process p = pb.start();
        String output = new String(Jars.readAll(p.getInputStream()), StandardCharsets.UTF_8);
        if (!p.waitFor(10, TimeUnit.MINUTES)) {
            p.destroyForcibly();
            errors.add("PatchTool did not finish");
            return false;
        }
        String shown = Arrays.stream(output.split("\n"))
                .filter(l -> !l.startsWith("Picked up JAVA_TOOL_OPTIONS") && !l.trim().isEmpty())
                .collect(Collectors.joining("\n"));
        if (!shown.isEmpty()) System.out.println(shown);
        if (p.exitValue() != 0) {
            errors.add("PatchTool failed (exit " + p.exitValue() + ")");
            return false;
        }
        return true;
    }

    // ---- 파일

    private static List<Path> javaFiles(Path root) throws IOException {
        if (!Files.isDirectory(root)) return new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root)) {
            return walk.filter(p -> p.toString().endsWith(".java") && Files.isRegularFile(p)).sorted()
                    .collect(Collectors.toList());
        }
    }

    /** 소스 폴더의 .java가 아닌 파일(리소스)을 클래스 폴더로 */
    private static void copyResources(Path sources, Path classes) throws IOException {
        if (!Files.isDirectory(sources)) return;
        try (Stream<Path> walk = Files.walk(sources)) {
            for (Path p : (Iterable<Path>) walk.filter(Files::isRegularFile)::iterator) {
                String name = p.getFileName().toString();
                if (name.endsWith(".java") || name.startsWith(".") || name.endsWith(".md")) continue;
                Path target = classes.resolve(sources.relativize(p).toString());
                Files.createDirectories(target.getParent());
                Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
    }

    private static void copyTree(Path from, Path to) throws IOException {
        try (Stream<Path> walk = Files.walk(from)) {
            for (Path p : (Iterable<Path>) walk.filter(Files::isRegularFile)::iterator) {
                Path target = to.resolve(from.relativize(p).toString());
                Files.createDirectories(target.getParent());
                Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
    }

    static void deleteTree(Path root) throws IOException {
        if (!Files.exists(root)) return;
        try (Stream<Path> walk = Files.walk(root)) {
            List<Path> all = walk.sorted(Collections.reverseOrder()).collect(Collectors.toList());
            for (Path p : all) Files.delete(p);
        }
    }
}
