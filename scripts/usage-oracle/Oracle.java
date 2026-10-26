import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.LineMap;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

// 사용처 정답표(spec §10.2). javac 자신의 이름 풀이로 생성 클래스(…sandbot.*)의 필드·상수·형식을 가리키는 참조를
// 모두 나열한다. 개발 도구다(JDK 11+, run.mjs가 단일 파일 소스로 실행한다). CI는 쓰지 않고 커밋한 정답표만 읽는다.
//
// java Oracle.java [--errors] <클래스 출력 폴더> <팀 루트> <소스 파일>...
// - 팀 루트 아래 src/main/java의 파일만 보고하고(경로는 팀 루트 기준, '/'), 생성 패키지 파일은 보고하지 않는다.
// - 보통: "경로:줄:열 종류 이름 [import] [qualifier]". 열은 이름 토큰의 시작(끝 위치 - 이름 길이, 1부터, 탭을 한 글자로).
//   위치가 없는(NOPOS) 합성 트리(형식 없는 람다 매개변수의 형식 등)와 의사 멤버 class(X.class)는 건너뛴다. 부모가 보고하는
//   멤버 선택(robot.lift.liftLeft)의 받는 쪽(robot.lift)은 qualifier로 표시한다. 컴파일 오류가 있으면 실패한다.
// - --errors: "경로:줄 이름". cannot find symbol의 기호 이름과, package … does not exist의 첫 이름(생성 패키지
//   안이면 생성 패키지 다음 이름. 없는 로봇 클래스로 쓴 Robot.X는 javac가 Robot을 패키지로 보고 알린다).
public class Oracle {
    static final String GEN = "org.firstinspires.ftc.teamcode.sandbot";

    public static void main(String[] args) throws Exception {
        List<String> rest = new ArrayList<>(Arrays.asList(args));
        boolean errorsMode = rest.remove("--errors");
        String out = rest.remove(0);
        Path teamRoot = Paths.get(rest.remove(0)).toAbsolutePath().normalize();
        List<File> files = new ArrayList<>();
        for (String name : rest) files.add(new File(name));

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        StandardJavaFileManager fm = compiler.getStandardFileManager(diagnostics, Locale.ROOT, null);
        JavacTask task = (JavacTask) compiler.getTask(
                null, fm, diagnostics,
                Arrays.asList("--release", "8", "-proc:none", "-Xlint:-options", "-Xmaxerrs", "100000", "-encoding", "UTF-8", "-d", out),
                null, fm.getJavaFileObjectsFromFiles(files));
        Iterable<? extends CompilationUnitTree> units = task.parse();
        task.analyze();

        List<String> lines = new ArrayList<>();
        if (errorsMode) {
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                if (d.getKind() != Diagnostic.Kind.ERROR || d.getSource() == null) continue;
                String path = teamPath(teamRoot, d.getSource());
                if (path == null) continue;
                String symbol = errorSymbol(d);
                if (symbol == null) {
                    System.err.println("cannot find symbol이 아닌 오류(정답표에 넣지 않음): " + path + ":" + d.getLineNumber() + " " + d.getCode());
                    continue;
                }
                lines.add(path + ":" + d.getLineNumber() + " " + symbol);
            }
        } else {
            boolean failed = false;
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                if (d.getKind() != Diagnostic.Kind.ERROR) continue;
                System.err.println(d);
                failed = true;
            }
            if (failed) {
                System.err.println("보통 씬의 말뭉치는 오류 없이 컴파일돼야 한다");
                System.exit(1);
            }
            Trees trees = Trees.instance(task);
            SourcePositions positions = trees.getSourcePositions();
            for (CompilationUnitTree unit : units) {
                String pkg = unit.getPackageName() == null ? "" : unit.getPackageName().toString();
                if (pkg.equals(GEN)) continue;
                String path = teamPath(teamRoot, unit.getSourceFile());
                if (path == null) continue;
                new Scanner(trees, positions, unit, path, lines).scan(unit, null);
            }
        }
        for (String line : lines) System.out.println(line);
    }

    // 팀 루트의 src/main/java 아래 파일이면 팀 루트 기준 경로('/'), 아니면 null
    static String teamPath(Path teamRoot, JavaFileObject source) {
        Path file = Paths.get(source.toUri()).toAbsolutePath().normalize();
        if (!file.startsWith(teamRoot.resolve("src/main/java"))) return null;
        return teamRoot.relativize(file).toString().replace(File.separatorChar, '/');
    }

    // cannot find symbol의 기호 이름("symbol:   variable liftLeft" → liftLeft, 메서드는 괄호 앞까지).
    // package X does not exist는 X가 생성 패키지 안일 때 생성 패키지 다음 이름(없는 로봇 클래스).
    static String errorSymbol(Diagnostic<? extends JavaFileObject> d) {
        String code = d.getCode();
        String message = d.getMessage(Locale.ROOT);
        if (code.startsWith("compiler.err.cant.resolve")) {
            for (String line : message.split("\n")) {
                String trimmed = line.trim();
                if (!trimmed.startsWith("symbol:")) continue;
                String[] words = trimmed.substring("symbol:".length()).trim().split("\\s+");
                String name = words[words.length - 1];
                int paren = name.indexOf('(');
                return paren >= 0 ? name.substring(0, paren) : name;
            }
            return null;
        }
        if (code.equals("compiler.err.doesnt.exist")) {
            // 이름 하나(Robot.X의 Robot)를 찾지 못하면 javac는 그것을 패키지로 보고 알린다
            String prefix = "package ";
            if (!message.startsWith(prefix)) return null;
            String pkg = message.substring(prefix.length()).split("\\s+")[0];
            if (pkg.startsWith(GEN + ".")) pkg = pkg.substring(GEN.length() + 1);
            return pkg.split("\\.")[0];
        }
        return null;
    }

    static class Scanner extends TreePathScanner<Void, Void> {
        final Trees trees;
        final SourcePositions positions;
        final CompilationUnitTree unit;
        final String path;
        final List<String> lines;
        boolean inImport = false;

        Scanner(Trees trees, SourcePositions positions, CompilationUnitTree unit, String path, List<String> lines) {
            this.trees = trees;
            this.positions = positions;
            this.unit = unit;
            this.path = path;
            this.lines = lines;
        }

        @Override
        public Void visitImport(ImportTree tree, Void unused) {
            inImport = true;
            super.visitImport(tree, unused);
            inImport = false;
            return null;
        }

        @Override
        public Void visitMemberSelect(MemberSelectTree tree, Void unused) {
            report(tree, tree.getIdentifier().toString());
            return super.visitMemberSelect(tree, unused);
        }

        @Override
        public Void visitIdentifier(IdentifierTree tree, Void unused) {
            report(tree, tree.getName().toString());
            return super.visitIdentifier(tree, unused);
        }

        // 생성 클래스의 필드·상수·형식이면 "종류 이름", 아니면 null
        String what(Element e, String name) {
            if (e == null || name.equals("class")) return null;
            if (e.getKind() == ElementKind.FIELD) {
                Element owner = e.getEnclosingElement();
                if (!(owner instanceof TypeElement)) return null;
                String q = ((TypeElement) owner).getQualifiedName().toString();
                if (!q.startsWith(GEN + ".")) return null;
                boolean isStatic = e.getModifiers().contains(Modifier.STATIC);
                return (isStatic ? "const " : "field ") + q.substring(GEN.length() + 1) + "." + name;
            }
            if (e.getKind().isClass() || e.getKind().isInterface()) {
                String q = ((TypeElement) e).getQualifiedName().toString();
                if (!q.startsWith(GEN + ".")) return null;
                return "type " + q.substring(GEN.length() + 1);
            }
            return null;
        }

        void report(Tree tree, String name) {
            TreePath current = getCurrentPath();
            String what = what(trees.getElement(current), name);
            if (what == null) return;
            long start = positions.getStartPosition(unit, tree);
            long end = positions.getEndPosition(unit, tree);
            if (start == Diagnostic.NOPOS || end == Diagnostic.NOPOS || end < start) return;
            long at = end - name.length();
            LineMap map = unit.getLineMap();
            long line = map.getLineNumber(at);
            long col = at - map.getStartPosition(line) + 1;
            StringBuilder text = new StringBuilder(path + ":" + line + ":" + col + " " + what);
            if (inImport) text.append(" [import]");
            if (isQualifier(current)) text.append(" [qualifier]");
            lines.add(text.toString());
        }

        // 부모가 이 트리를 받는 쪽으로 둔 멤버 선택이고, 그 부모도 보고하는 참조인가
        boolean isQualifier(TreePath current) {
            TreePath parent = current.getParentPath();
            if (parent == null || !(parent.getLeaf() instanceof MemberSelectTree)) return false;
            MemberSelectTree select = (MemberSelectTree) parent.getLeaf();
            if (select.getExpression() != current.getLeaf()) return false;
            return what(trees.getElement(parent), select.getIdentifier().toString()) != null;
        }
    }
}
