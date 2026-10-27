package org.sandbot.tools;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import javax.lang.model.element.AnnotationMirror;
import javax.lang.model.element.AnnotationValue;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.NestingKind;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.TypeParameterElement;
import javax.lang.model.element.VariableElement;
import javax.lang.model.type.ArrayType;
import javax.lang.model.type.DeclaredType;
import javax.lang.model.type.ErrorType;
import javax.lang.model.type.ExecutableType;
import javax.lang.model.type.TypeKind;
import javax.lang.model.type.TypeMirror;
import javax.lang.model.type.TypeVariable;
import javax.lang.model.type.WildcardType;
import javax.lang.model.util.Elements;
import javax.lang.model.util.SimpleAnnotationValueVisitor8;
import javax.lang.model.util.Types;

/**
 * 껍데기(stub) 소스 생성(§2.2-3). 실제 SDK jar를 javac 모델(Elements)로 읽어 public·protected API를 Java 소스로 쓴다.
 *
 * <ul>
 *   <li>메서드·생성자 본문은 {@code throw new org.sandbot.sim.SimUnsupportedException("<바이너리 클래스>#<메서드>(<인수 형식>)")}.
 *   <li>생성자는 먼저 상위 클래스의 접근 가능한 생성자를 형변환한 기본값으로 부른다(오버로드가 정확히 하나로 정해지게).
 *   <li>상수(ConstantValue)는 같은 값의 상수로, 상수가 아닌 final 필드는 상수가 되지 않는 초기값(Integer.valueOf(0).intValue()·
 *       null)으로 둔다. 정적 초기화는 던지지 않는다.
 *   <li>공개 API에 나오는 패키지-private 형식(상위 클래스, 서명의 형식)은 필요한 것만 같은 접근으로 쓴다. 패키지-private 생성자도
 *       쓴다(같은 패키지 하위 클래스의 super 호출). 생성자가 private뿐이면 private 생성자 하나를 둔다(기본 public 생성자가 생기지 않게).
 *   <li>enum 상수의 본문과 enum 메서드의 abstract는 쓰지 않는다(상수는 클래스 파일 순서 그대로).
 *   <li>런타임에 보이는 애너테이션은 그대로 쓴다(형식이 껍데기가 아닌 것만).
 *   <li>손 구현·들여온·JDK가 아닌 형식(안드로이드, 없는 라이브러리 형식)은 멤버 없는 불투명 껍데기로 쓴다(종류·형식 매개변수만,
 *       Throwable 하위면 상위 클래스도). 생성자는 protected 인수 없는 것 하나.
 * </ul>
 */
final class StubGen {
    private final Elements elements;
    private final Types types;
    /** stub으로 쓸 최상위 묶음(내부 이름) */
    private final Set<String> stubNests;
    /** 손 구현·sim·들여온 클래스(내부 이름) — 클래스 파일로 있다 */
    private final Set<String> provided;
    private final ClassSource real;
    private final ClassSource android;
    private final Path outDir;

    /** 써야 하는 non-public 요소(공개 서명에 나와서) */
    private final Set<String> required = new HashSet<>();
    /** 쓴 최상위(내부 이름) → 소스 */
    private final Map<String, String> sources = new TreeMap<>();
    /** 불투명 껍데기로 쓸 형식: 바이너리 내부 이름 → 정보 */
    private final Map<String, Opaque> opaque = new TreeMap<>();
    final List<String> warnings = new ArrayList<>();

    private static final class Opaque {
        /** 안드로이드 jar의 요소(없는 형식이면 null) */
        TypeElement element;
        String kind = "class";
        int arity;
        boolean throwable;
    }

    StubGen(Elements elements, Types types, Set<String> stubNests, Set<String> provided, ClassSource real,
            ClassSource android, Path outDir) {
        this.elements = elements;
        this.types = types;
        this.stubNests = stubNests;
        this.provided = provided;
        this.real = real;
        this.android = android;
        this.outDir = outDir;
    }

    /** 공개 stub 묶음과 그 서명이 부르는 것을 모두 쓴다. extraOpaque: 손 구현이 쓰는 안드로이드·없는 형식. */
    int run(Collection<String> extraOpaque) throws IOException {
        Set<String> toWrite = new TreeSet<>();
        for (String nest : stubNests) {
            TypeElement type = topLevel(nest);
            if (type == null) {
                warnings.add("cannot read " + dotted(nest) + " from the SDK jar");
                continue;
            }
            if (type.getModifiers().contains(Modifier.PUBLIC)) toWrite.add(nest);
        }
        for (String name : extraOpaque) markOpaque(name, null, null);
        // 공개 서명이 non-public 형식을 부르면 그 형식(과 최상위)도 쓴다. 쓸 것이 더 늘지 않을 때까지 모두 다시 쓴다
        // (글자 만들기만이라 빠르고, 집합은 줄어들지 않으므로 끝난다).
        while (true) {
            int requiredBefore = required.size();
            Set<String> tops = new TreeSet<>(toWrite);
            sources.clear();
            for (String nest : tops) {
                Set<String> wantedTops = new LinkedHashSet<>();
                sources.put(nest, write(topLevel(nest), wantedTops));
                toWrite.addAll(wantedTops);
            }
            if (required.size() == requiredBefore && toWrite.size() == tops.size()) break;
        }
        for (Map.Entry<String, String> e : sources.entrySet()) writeFile(e.getKey(), e.getValue());
        writeOpaque();
        return sources.size();
    }

    int opaqueCount() {
        return opaqueTops.size();
    }

    private final Set<String> opaqueTops = new TreeSet<>();

    // ---- 이름

    private TypeElement topLevel(String internalName) {
        return elements.getTypeElement(internalName.replace('/', '.'));
    }

    private String internal(TypeElement type) {
        return elements.getBinaryName(type).toString().replace('.', '/');
    }

    private static String topOf(String internalName) {
        int dollar = internalName.indexOf('$');
        return dollar < 0 ? internalName : internalName.substring(0, dollar);
    }

    static String dotted(String internalName) {
        return internalName.replace('/', '.');
    }

    private TypeElement outermost(TypeElement type) {
        Element current = type;
        while (current.getEnclosingElement() != null && current.getEnclosingElement() instanceof TypeElement)
            current = current.getEnclosingElement();
        return (TypeElement) current;
    }

    private enum Category {
        STUB,
        PROVIDED,
        JDK,
        OPAQUE
    }

    private Category category(TypeElement type) {
        String top = internal(outermost(type));
        if (stubNests.contains(top)) return Category.STUB;
        String name = internal(type);
        if (provided.contains(name) || provided.contains(top)) return Category.PROVIDED;
        if (android.has(name) || real.has(name)) return Category.OPAQUE;
        return Category.JDK;
    }

    // ---- 형식 글자(정규 이름, 애너테이션 없이). 부르는 형식을 wanted에 모은다.

    private Set<String> wanted = new LinkedHashSet<>();
    private String usage;

    private String type(TypeMirror t) {
        switch (t.getKind()) {
            case BOOLEAN:
                return "boolean";
            case BYTE:
                return "byte";
            case SHORT:
                return "short";
            case INT:
                return "int";
            case LONG:
                return "long";
            case CHAR:
                return "char";
            case FLOAT:
                return "float";
            case DOUBLE:
                return "double";
            case VOID:
                return "void";
            case ARRAY:
                return type(((ArrayType) t).getComponentType()) + "[]";
            case TYPEVAR:
                return ((TypeVariable) t).asElement().getSimpleName().toString();
            case WILDCARD: {
                WildcardType w = (WildcardType) t;
                if (w.getExtendsBound() != null) return "? extends " + type(w.getExtendsBound());
                if (w.getSuperBound() != null) return "? super " + type(w.getSuperBound());
                return "?";
            }
            case ERROR:
                return errorType((ErrorType) t);
            case DECLARED:
                return declared((DeclaredType) t);
            default:
                throw new IllegalStateException("unexpected type " + t + " (" + t.getKind() + ")");
        }
    }

    private String declared(DeclaredType t) {
        TypeElement e = (TypeElement) t.asElement();
        String args = typeArguments(t.getTypeArguments());
        reference(e, t.getTypeArguments().size());
        TypeMirror enclosing = t.getEnclosingType();
        boolean inner = e.getNestingKind() == NestingKind.MEMBER && !e.getModifiers().contains(Modifier.STATIC);
        if (inner && enclosing.getKind() == TypeKind.DECLARED
                && !((DeclaredType) enclosing).getTypeArguments().isEmpty()) {
            return declared((DeclaredType) enclosing) + "." + e.getSimpleName() + args;
        }
        return e.getQualifiedName() + args;
    }

    private String typeArguments(List<? extends TypeMirror> args) {
        if (args.isEmpty()) return "";
        StringBuilder s = new StringBuilder("<");
        for (int i = 0; i < args.size(); i++) {
            if (i > 0) s.append(", ");
            s.append(type(args.get(i)));
        }
        return s.append('>').toString();
    }

    /** 없는 라이브러리 형식(OpenCV 등): 이름만 알고 불투명 껍데기로 쓴다 */
    private String errorType(ErrorType t) {
        Element e = t.asElement();
        String binary = binaryOfError(e);
        markOpaque(binary, usage, t.getTypeArguments().size());
        return qualifiedOfError(e) + typeArguments(t.getTypeArguments());
    }

    private String binaryOfError(Element e) {
        Element enclosing = e.getEnclosingElement();
        if (enclosing instanceof TypeElement) return binaryOfError(enclosing) + "$" + e.getSimpleName();
        String qualified = ((TypeElement) e).getQualifiedName().toString();
        return qualified.replace('.', '/');
    }

    private String qualifiedOfError(Element e) {
        return ((TypeElement) e).getQualifiedName().toString().replace('$', '.');
    }

    /** 형식 하나를 쓴다고 기록한다 */
    private void reference(TypeElement e, int arity) {
        Category c;
        try {
            c = category(e);
        } catch (RuntimeException failure) {
            markOpaque(e.getQualifiedName().toString().replace('.', '/'), usage, arity);
            return;
        }
        String name = internal(e);
        if (c == Category.STUB) {
            wanted.add(internal(outermost(e)));
            // non-public이면 그것과 감싸는 형식을 쓴다
            Element current = e;
            while (current instanceof TypeElement) {
                if (!isPubliclyVisible((TypeElement) current)) required.add(internal((TypeElement) current));
                current = current.getEnclosingElement();
            }
        } else if (c == Category.OPAQUE) {
            markOpaque(name, usage, arity);
        }
    }

    private boolean isPubliclyVisible(TypeElement e) {
        Element current = e;
        while (current instanceof TypeElement) {
            Set<Modifier> m = current.getModifiers();
            boolean inInterface = current.getEnclosingElement() instanceof TypeElement
                    && current.getEnclosingElement().getKind().isInterface();
            if (!m.contains(Modifier.PUBLIC) && !m.contains(Modifier.PROTECTED) && !inInterface) return false;
            current = current.getEnclosingElement();
        }
        return true;
    }

    private void markOpaque(String internalName, String use, Integer arity) {
        Opaque o = opaque.computeIfAbsent(internalName, k -> new Opaque());
        if (o.element == null) {
            ClassFile file = android.get(internalName);
            if (file != null) {
                TypeElement element = elements.getTypeElement(canonicalOfAndroid(internalName));
                if (element != null) o.element = element;
            }
        }
        if (arity != null) o.arity = Math.max(o.arity, arity);
        if ("implements".equals(use)) o.kind = "interface";
        if ("throws".equals(use)) o.throwable = true;
    }

    private String canonicalOfAndroid(String internalName) {
        return internalName.replace('/', '.').replace('$', '.');
    }

    // ---- 소스 쓰기

    private String write(TypeElement top, Set<String> wantedOut) {
        Set<String> saved = wanted;
        wanted = wantedOut;
        try {
            StringBuilder out = new StringBuilder();
            String pkg = elements.getPackageOf(top).getQualifiedName().toString();
            out.append("// SandBot: 생성한 껍데기(stub). FTC SDK 12.0.0의 public·protected API, 본문은 SimUnsupportedException.\n");
            out.append("// 고치지 말 것(scripts/build-sidecar.mjs가 다시 만든다).\n");
            if (!pkg.isEmpty()) out.append("package ").append(pkg).append(";\n\n");
            typeDeclaration(top, out, "");
            return out.toString();
        } finally {
            wanted = saved;
        }
    }

    private boolean shouldEmit(TypeElement nested) {
        Set<Modifier> m = nested.getModifiers();
        if (m.contains(Modifier.PUBLIC) || m.contains(Modifier.PROTECTED)) return true;
        if (nested.getEnclosingElement().getKind().isInterface()) return true;
        return required.contains(internal(nested));
    }

    private void typeDeclaration(TypeElement type, StringBuilder out, String indent) {
        ElementKind kind = type.getKind();
        boolean nested = type.getNestingKind() == NestingKind.MEMBER;
        StringBuilder head = new StringBuilder(indent);
        annotations(type, head, indent);
        Set<Modifier> mods = type.getModifiers();
        if (mods.contains(Modifier.PUBLIC)) head.append("public ");
        if (mods.contains(Modifier.PROTECTED)) head.append("protected ");
        if (mods.contains(Modifier.PRIVATE)) head.append("private ");
        if (nested && mods.contains(Modifier.STATIC) && kind == ElementKind.CLASS) head.append("static ");
        if (kind == ElementKind.CLASS) {
            if (mods.contains(Modifier.ABSTRACT)) head.append("abstract ");
            if (mods.contains(Modifier.FINAL)) head.append("final ");
        }
        switch (kind) {
            case INTERFACE:
                head.append("interface ");
                break;
            case ANNOTATION_TYPE:
                head.append("@interface ");
                break;
            case ENUM:
                head.append("enum ");
                break;
            default:
                head.append("class ");
        }
        head.append(type.getSimpleName()).append(typeParameters(type.getTypeParameters()));
        if (kind == ElementKind.CLASS) {
            TypeMirror sup = type.getSuperclass();
            if (sup.getKind() != TypeKind.NONE && !isObject(sup)) {
                usage = "extends";
                head.append(" extends ").append(type(sup));
                usage = null;
            }
        }
        if (kind != ElementKind.ANNOTATION_TYPE && !type.getInterfaces().isEmpty()) {
            head.append(kind == ElementKind.INTERFACE ? " extends " : " implements ");
            usage = kind == ElementKind.INTERFACE ? "implements" : "implements";
            List<String> list = new ArrayList<>();
            for (TypeMirror i : type.getInterfaces()) list.add(type(i));
            usage = null;
            head.append(String.join(", ", list));
        }
        out.append(head).append(" {\n");
        String inner = indent + "    ";
        if (kind == ElementKind.ENUM) enumConstants(type, out, inner);
        for (Element member : type.getEnclosedElements()) {
            switch (member.getKind()) {
                case FIELD:
                    field(type, (VariableElement) member, out, inner);
                    break;
                case METHOD:
                    method(type, (ExecutableElement) member, out, inner);
                    break;
                default:
                    break;
            }
        }
        if (kind == ElementKind.CLASS) constructors(type, out, inner);
        for (Element member : type.getEnclosedElements()) {
            if (member instanceof TypeElement && shouldEmit((TypeElement) member)) {
                out.append('\n');
                typeDeclaration((TypeElement) member, out, inner);
            }
        }
        out.append(indent).append("}\n");
    }

    private static boolean isObject(TypeMirror t) {
        return t.getKind() == TypeKind.DECLARED
                && ((TypeElement) ((DeclaredType) t).asElement()).getQualifiedName().contentEquals("java.lang.Object");
    }

    private String typeParameters(List<? extends TypeParameterElement> params) {
        if (params.isEmpty()) return "";
        List<String> list = new ArrayList<>();
        for (TypeParameterElement p : params) {
            StringBuilder s = new StringBuilder(p.getSimpleName());
            List<String> bounds = new ArrayList<>();
            for (TypeMirror b : p.getBounds()) if (!isObject(b) || p.getBounds().size() > 1) bounds.add(type(b));
            if (!bounds.isEmpty()) s.append(" extends ").append(String.join(" & ", bounds));
            list.add(s.toString());
        }
        return "<" + String.join(", ", list) + ">";
    }

    private void enumConstants(TypeElement type, StringBuilder out, String indent) {
        // 클래스 파일의 필드 순서(=ordinal)
        List<String> names = new ArrayList<>();
        ClassFile file = real.get(internal(type));
        if (file != null) {
            for (ClassFile.Member f : file.fields) if ((f.access & ClassFile.ACC_ENUM) != 0) names.add(f.name);
        } else {
            for (Element e : type.getEnclosedElements())
                if (e.getKind() == ElementKind.ENUM_CONSTANT) names.add(e.getSimpleName().toString());
        }
        Map<String, Element> byName = new HashMap<>();
        for (Element e : type.getEnclosedElements())
            if (e.getKind() == ElementKind.ENUM_CONSTANT) byName.put(e.getSimpleName().toString(), e);
        List<String> items = new ArrayList<>();
        for (String name : names) {
            StringBuilder s = new StringBuilder();
            Element e = byName.get(name);
            if (e != null) annotations(e, s, null);
            items.add(indent + s + name);
        }
        out.append(String.join(",\n", items)).append(";\n");
    }

    private void field(TypeElement owner, VariableElement f, StringBuilder out, String indent) {
        Set<Modifier> m = f.getModifiers();
        boolean inInterface = owner.getKind().isInterface();
        if (!inInterface && !m.contains(Modifier.PUBLIC) && !m.contains(Modifier.PROTECTED)) return;
        StringBuilder s = new StringBuilder(indent);
        annotations(f, s, indent);
        if (m.contains(Modifier.PUBLIC) || inInterface) s.append("public ");
        if (m.contains(Modifier.PROTECTED)) s.append("protected ");
        if (m.contains(Modifier.STATIC) || inInterface) s.append("static ");
        if (m.contains(Modifier.FINAL) || inInterface) s.append("final ");
        if (m.contains(Modifier.TRANSIENT)) s.append("transient ");
        if (m.contains(Modifier.VOLATILE)) s.append("volatile ");
        s.append(type(f.asType())).append(' ').append(f.getSimpleName());
        Object constant = f.getConstantValue();
        if (constant != null) {
            s.append(" = ").append(constantLiteral(constant, f.asType()));
        } else if (m.contains(Modifier.FINAL) || inInterface) {
            s.append(" = ").append(nonConstantDefault(f.asType()));
        }
        out.append(s).append(";\n");
    }

    private void method(TypeElement owner, ExecutableElement method, StringBuilder out, String indent) {
        Set<Modifier> m = method.getModifiers();
        boolean inInterface = owner.getKind().isInterface();
        String name = method.getSimpleName().toString();
        if (owner.getKind() == ElementKind.ENUM && m.contains(Modifier.STATIC)) {
            if (name.equals("values") && method.getParameters().isEmpty()) return;
            if (name.equals("valueOf") && method.getParameters().size() == 1
                    && method.getParameters().get(0).asType().toString().equals("java.lang.String")) return;
        }
        boolean visible = m.contains(Modifier.PUBLIC) || m.contains(Modifier.PROTECTED);
        if (!visible && !(inInterface && !m.contains(Modifier.PRIVATE))) {
            // 패키지-private 메서드는 상위 형식의 추상 메서드를 구현할 때만(구체 클래스가 컴파일되게)
            if (m.contains(Modifier.PRIVATE) || m.contains(Modifier.STATIC) || !implementsAbstract(owner, method))
                return;
        }
        StringBuilder s = new StringBuilder(indent);
        annotations(method, s, indent);
        if (m.contains(Modifier.PUBLIC)) s.append("public ");
        if (m.contains(Modifier.PROTECTED)) s.append("protected ");
        boolean isAbstract = m.contains(Modifier.ABSTRACT) && owner.getKind() != ElementKind.ENUM;
        if (owner.getKind() == ElementKind.ANNOTATION_TYPE) {
            s.append(type(method.getReturnType())).append(' ').append(name).append("()");
            AnnotationValue def = method.getDefaultValue();
            if (def != null) s.append(" default ").append(annotationValue(def));
            out.append(s).append(";\n");
            return;
        }
        if (inInterface) {
            if (m.contains(Modifier.STATIC)) s.append("static ");
            else if (m.contains(Modifier.DEFAULT)) s.append("default ");
        } else {
            if (isAbstract) s.append("abstract ");
            if (m.contains(Modifier.STATIC)) s.append("static ");
            if (m.contains(Modifier.FINAL)) s.append("final ");
        }
        String typeParams = typeParameters(method.getTypeParameters());
        if (!typeParams.isEmpty()) s.append(typeParams).append(' ');
        s.append(type(method.getReturnType())).append(' ').append(name);
        parameters(method, s);
        throwsClause(method, s);
        boolean hasBody = inInterface ? m.contains(Modifier.STATIC) || m.contains(Modifier.DEFAULT) : !isAbstract;
        if (hasBody) s.append(" {\n").append(indent).append("    ").append(unsupported(owner, method)).append('\n')
                .append(indent).append("}\n");
        else s.append(";\n");
        out.append(s);
    }

    private boolean implementsAbstract(TypeElement owner, ExecutableElement method) {
        if (owner.getModifiers().contains(Modifier.ABSTRACT)) return false;
        for (TypeMirror sup : allSupertypes(owner)) {
            TypeElement e = (TypeElement) ((DeclaredType) sup).asElement();
            for (Element member : e.getEnclosedElements()) {
                if (member.getKind() == ElementKind.METHOD && member.getModifiers().contains(Modifier.ABSTRACT)
                        && member.getSimpleName().equals(method.getSimpleName())
                        && elements.overrides(method, (ExecutableElement) member, owner)) return true;
            }
        }
        return false;
    }

    private List<TypeMirror> allSupertypes(TypeElement type) {
        List<TypeMirror> result = new ArrayList<>();
        Deque<TypeMirror> queue = new ArrayDeque<>(types.directSupertypes(type.asType()));
        Set<String> seen = new HashSet<>();
        while (!queue.isEmpty()) {
            TypeMirror t = queue.poll();
            if (t.getKind() != TypeKind.DECLARED || !seen.add(types.erasure(t).toString())) continue;
            result.add(t);
            queue.addAll(types.directSupertypes(t));
        }
        return result;
    }

    private void parameters(ExecutableElement method, StringBuilder s) {
        s.append('(');
        List<? extends VariableElement> params = method.getParameters();
        for (int i = 0; i < params.size(); i++) {
            if (i > 0) s.append(", ");
            VariableElement p = params.get(i);
            annotations(p, s, null);
            TypeMirror t = p.asType();
            if (method.isVarArgs() && i == params.size() - 1 && t.getKind() == TypeKind.ARRAY)
                s.append(type(((ArrayType) t).getComponentType())).append("...");
            else s.append(type(t));
            s.append(" p").append(i);
        }
        s.append(')');
    }

    private void throwsClause(ExecutableElement method, StringBuilder s) {
        if (method.getThrownTypes().isEmpty()) return;
        usage = "throws";
        List<String> list = new ArrayList<>();
        for (TypeMirror t : method.getThrownTypes()) list.add(type(t));
        usage = null;
        s.append(" throws ").append(String.join(", ", list));
    }

    /** 본문: 바이너리 클래스#메서드(인수 형식, Class.getTypeName 모양) */
    private String unsupported(TypeElement owner, ExecutableElement method) {
        StringBuilder api = new StringBuilder(elements.getBinaryName(owner)).append('#');
        api.append(method.getKind() == ElementKind.CONSTRUCTOR ? "<init>" : method.getSimpleName()).append('(');
        List<? extends VariableElement> params = method.getParameters();
        for (int i = 0; i < params.size(); i++) {
            if (i > 0) api.append(',');
            api.append(erasedName(params.get(i).asType()));
        }
        api.append(')');
        return "throw new org.sandbot.sim.SimUnsupportedException(\"" + javaString(api.toString()) + "\");";
    }

    private String erasedName(TypeMirror t) {
        TypeMirror e = types.erasure(t);
        if (e.getKind() == TypeKind.ARRAY) return erasedName(((ArrayType) e).getComponentType()) + "[]";
        if (e.getKind() == TypeKind.DECLARED) return elements.getBinaryName((TypeElement) ((DeclaredType) e).asElement()).toString();
        if (e.getKind() == TypeKind.ERROR) return dotted(binaryOfError(((ErrorType) e).asElement()));
        return e.toString();
    }

    private void constructors(TypeElement type, StringBuilder out, String indent) {
        List<ExecutableElement> ctors = new ArrayList<>();
        for (Element e : type.getEnclosedElements()) {
            if (e.getKind() == ElementKind.CONSTRUCTOR && !e.getModifiers().contains(Modifier.PRIVATE))
                ctors.add((ExecutableElement) e);
        }
        String superCall = superCall(type);
        if (ctors.isEmpty()) {
            // private 생성자뿐: 바깥에서 만들 수 없게 private 생성자 하나(기본 public 생성자가 생기지 않게)
            out.append(indent).append("private ").append(type.getSimpleName()).append("() {\n");
            if (!superCall.isEmpty()) out.append(indent).append("    ").append(superCall).append('\n');
            out.append(indent).append("    throw new org.sandbot.sim.SimUnsupportedException(\"")
                    .append(javaString(elements.getBinaryName(type) + "#<init>()")).append("\");\n");
            out.append(indent).append("}\n");
            return;
        }
        for (ExecutableElement ctor : ctors) {
            StringBuilder s = new StringBuilder(indent);
            annotations(ctor, s, indent);
            Set<Modifier> m = ctor.getModifiers();
            if (m.contains(Modifier.PUBLIC)) s.append("public ");
            if (m.contains(Modifier.PROTECTED)) s.append("protected ");
            String typeParams = typeParameters(ctor.getTypeParameters());
            if (!typeParams.isEmpty()) s.append(typeParams).append(' ');
            s.append(type.getSimpleName());
            parameters(ctor, s);
            throwsClause(ctor, s);
            s.append(" {\n");
            if (!superCall.isEmpty()) s.append(indent).append("    ").append(superCall).append('\n');
            s.append(indent).append("    ").append(unsupported(type, ctor)).append('\n');
            s.append(indent).append("}\n");
            out.append(s);
        }
    }

    /** 상위 클래스 생성자 호출. Object나 불투명 상위면 super() 또는 빈 글자. */
    private String superCall(TypeElement type) {
        TypeMirror sup = type.getSuperclass();
        if (sup.getKind() == TypeKind.NONE || isObject(sup)) return "";
        if (sup.getKind() == TypeKind.ERROR) return "super();";
        DeclaredType supType = (DeclaredType) sup;
        TypeElement supElement = (TypeElement) supType.asElement();
        Category c = category(supElement);
        if (c == Category.OPAQUE) return "super();";
        ExecutableElement best = null;
        ExecutableType bestType = null;
        boolean samePackage = elements.getPackageOf(supElement).equals(elements.getPackageOf(type));
        boolean sameTop = outermost(supElement).equals(outermost(type));
        boolean anyNonPrivate = false;
        for (Element e : supElement.getEnclosedElements()) {
            if (e.getKind() != ElementKind.CONSTRUCTOR) continue;
            Set<Modifier> m = e.getModifiers();
            if (!m.contains(Modifier.PRIVATE)) anyNonPrivate = true;
            boolean accessible = m.contains(Modifier.PUBLIC) || m.contains(Modifier.PROTECTED)
                    || (m.contains(Modifier.PRIVATE) ? sameTop && c != Category.STUB : samePackage);
            if (!accessible) continue;
            ExecutableElement ctor = (ExecutableElement) e;
            if (!throwsCovered(ctor)) continue;
            if (best == null || ctor.getParameters().size() < best.getParameters().size()) {
                best = ctor;
                bestType = (ExecutableType) types.asMemberOf(supType, ctor);
            }
        }
        String qualifier = enclosingQualifier(type, supElement);
        if (best == null) {
            // stub 상위가 private 생성자뿐이면 그 대신 쓴 private 인수 없는 생성자
            if (c == Category.STUB && !anyNonPrivate) return qualifier + "super();";
            warnings.add(elements.getBinaryName(type) + ": no accessible constructor of " + supElement.getQualifiedName());
            return qualifier + "super();";
        }
        List<String> args = new ArrayList<>();
        for (TypeMirror p : bestType.getParameterTypes()) args.add(defaultArgument(p));
        return qualifier + "super(" + String.join(", ", args) + ");";
    }

    /** 상위 클래스가 내부(비정적) 클래스이고 바깥 인스턴스가 없으면 ((Outer) null). */
    private String enclosingQualifier(TypeElement type, TypeElement sup) {
        if (sup.getNestingKind() != NestingKind.MEMBER || sup.getModifiers().contains(Modifier.STATIC)
                || sup.getEnclosingElement().getKind().isInterface()) return "";
        TypeElement outer = (TypeElement) sup.getEnclosingElement();
        Element current = type;
        while (current.getEnclosingElement() instanceof TypeElement) {
            boolean isStatic = current.getModifiers().contains(Modifier.STATIC) || current.getKind().isInterface()
                    || current.getKind() == ElementKind.ENUM;
            TypeElement enclosing = (TypeElement) current.getEnclosingElement();
            if (isStatic) break;
            if (types.isSubtype(types.erasure(enclosing.asType()), types.erasure(outer.asType()))) return "";
            current = enclosing;
        }
        return "((" + type(types.erasure(outer.asType())) + ") null).";
    }

    private boolean throwsCovered(ExecutableElement ctor) {
        TypeMirror runtime = elements.getTypeElement("java.lang.RuntimeException").asType();
        TypeMirror error = elements.getTypeElement("java.lang.Error").asType();
        for (TypeMirror t : ctor.getThrownTypes()) {
            if (t.getKind() == TypeKind.DECLARED && (types.isSubtype(t, runtime) || types.isSubtype(t, error))) continue;
            // 우리 생성자는 같은 throws를 가지지 않을 수 있으므로 검사 예외를 던지는 상위 생성자는 피한다
            return false;
        }
        return true;
    }

    private String defaultArgument(TypeMirror p) {
        switch (p.getKind()) {
            case BOOLEAN:
                return "false";
            case BYTE:
                return "(byte) 0";
            case SHORT:
                return "(short) 0";
            case CHAR:
                return "(char) 0";
            case INT:
                return "0";
            case LONG:
                return "0L";
            case FLOAT:
                return "0.0f";
            case DOUBLE:
                return "0.0";
            default:
                // 상위 생성자의 (치환한) 매개변수 형식 그대로: 형식 변수·제네릭이어도 받는 쪽과 맞는다
                return "(" + type(p) + ") null";
        }
    }

    private String nonConstantDefault(TypeMirror t) {
        switch (t.getKind()) {
            case BOOLEAN:
                return "java.lang.Boolean.FALSE.booleanValue()";
            case BYTE:
                return "java.lang.Byte.valueOf((byte) 0).byteValue()";
            case SHORT:
                return "java.lang.Short.valueOf((short) 0).shortValue()";
            case CHAR:
                return "java.lang.Character.valueOf((char) 0).charValue()";
            case INT:
                return "java.lang.Integer.valueOf(0).intValue()";
            case LONG:
                return "java.lang.Long.valueOf(0L).longValue()";
            case FLOAT:
                return "java.lang.Float.valueOf(0.0f).floatValue()";
            case DOUBLE:
                return "java.lang.Double.valueOf(0.0).doubleValue()";
            default:
                return "null";
        }
    }

    /** 필드 형식에 맞는 상수 글자(정확히 같은 값) */
    static String constantLiteral(Object value, TypeMirror type) {
        switch (type.getKind()) {
            case BOOLEAN:
                if (value instanceof Boolean) return value.toString();
                return ((Number) value).intValue() != 0 ? "true" : "false";
            case CHAR: {
                int c = value instanceof Character ? (Character) value : ((Number) value).intValue();
                return "(char) " + c;
            }
            case BYTE:
                return "(byte) " + ((Number) value).intValue();
            case SHORT:
                return "(short) " + ((Number) value).intValue();
            default:
                return literal(value);
        }
    }

    static String literal(Object value) {
        if (value instanceof String) return "\"" + javaString((String) value) + "\"";
        if (value instanceof Integer) return value.toString();
        if (value instanceof Long) return value + "L";
        if (value instanceof Float) {
            float f = (Float) value;
            if (Float.isNaN(f)) return "java.lang.Float.NaN";
            if (f == Float.POSITIVE_INFINITY) return "java.lang.Float.POSITIVE_INFINITY";
            if (f == Float.NEGATIVE_INFINITY) return "java.lang.Float.NEGATIVE_INFINITY";
            return Float.toString(f) + "f";
        }
        if (value instanceof Double) {
            double d = (Double) value;
            if (Double.isNaN(d)) return "java.lang.Double.NaN";
            if (d == Double.POSITIVE_INFINITY) return "java.lang.Double.POSITIVE_INFINITY";
            if (d == Double.NEGATIVE_INFINITY) return "java.lang.Double.NEGATIVE_INFINITY";
            return Double.toString(d) + "d";
        }
        if (value instanceof Character) return "(char) " + (int) (Character) value;
        if (value instanceof Boolean) return value.toString();
        if (value instanceof Byte) return "(byte) " + value;
        if (value instanceof Short) return "(short) " + value;
        throw new IllegalArgumentException("constant " + value);
    }

    /** 자바 문자열 리터럴 안의 글자. \\u 이스케이프는 쓰지 않는다(줄바꿈 \\u000a가 소스를 깬다): 제어 문자는 8진, 그 밖은 그대로. */
    static String javaString(String s) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    out.append("\\\"");
                    break;
                case '\\':
                    out.append("\\\\");
                    break;
                case '\n':
                    out.append("\\n");
                    break;
                case '\r':
                    out.append("\\r");
                    break;
                case '\t':
                    out.append("\\t");
                    break;
                case '\b':
                    out.append("\\b");
                    break;
                case '\f':
                    out.append("\\f");
                    break;
                default:
                    if (c < 0x20 || c == 0x7f) out.append(String.format("\\%03o", (int) c));
                    else if (c >= 0x80) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.toString();
    }

    // ---- 애너테이션

    /** 런타임에 보이는 애너테이션만(형식이 껍데기·불투명이 아닌 것). indent가 null이면 한 줄로. */
    private void annotations(Element e, StringBuilder s, String indent) {
        for (AnnotationMirror a : e.getAnnotationMirrors()) {
            TypeElement annotationType = (TypeElement) a.getAnnotationType().asElement();
            if (!isRuntimeRetained(annotationType)) continue;
            Category c;
            try {
                c = category(annotationType);
            } catch (RuntimeException failure) {
                continue;
            }
            if (c == Category.OPAQUE) continue;
            s.append(annotationMirror(a));
            if (indent == null) s.append(' ');
            else s.append('\n').append(indent);
        }
    }

    private boolean isRuntimeRetained(TypeElement annotationType) {
        try {
            for (AnnotationMirror meta : annotationType.getAnnotationMirrors()) {
                if (!((TypeElement) meta.getAnnotationType().asElement()).getQualifiedName()
                        .contentEquals("java.lang.annotation.Retention")) continue;
                for (AnnotationValue v : meta.getElementValues().values())
                    return v.getValue().toString().equals("RUNTIME");
            }
        } catch (RuntimeException failure) {
            return false;
        }
        return false;
    }

    private String annotationMirror(AnnotationMirror a) {
        StringBuilder s = new StringBuilder("@").append(type(a.getAnnotationType()));
        Map<? extends ExecutableElement, ? extends AnnotationValue> values = a.getElementValues();
        if (!values.isEmpty()) {
            List<String> pairs = new ArrayList<>();
            for (Map.Entry<? extends ExecutableElement, ? extends AnnotationValue> v : values.entrySet())
                pairs.add(v.getKey().getSimpleName() + " = " + annotationValue(v.getValue()));
            s.append('(').append(String.join(", ", pairs)).append(')');
        }
        return s.toString();
    }

    private String annotationValue(AnnotationValue value) {
        return value.accept(new SimpleAnnotationValueVisitor8<String, Void>() {
            @Override
            public String visitBoolean(boolean b, Void p) {
                return Boolean.toString(b);
            }

            @Override
            public String visitByte(byte b, Void p) {
                return "(byte) " + b;
            }

            @Override
            public String visitChar(char c, Void p) {
                return "(char) " + (int) c;
            }

            @Override
            public String visitShort(short v, Void p) {
                return "(short) " + v;
            }

            @Override
            public String visitInt(int i, Void p) {
                return Integer.toString(i);
            }

            @Override
            public String visitLong(long i, Void p) {
                return i + "L";
            }

            @Override
            public String visitFloat(float f, Void p) {
                return literal(f);
            }

            @Override
            public String visitDouble(double d, Void p) {
                return literal(d);
            }

            @Override
            public String visitString(String str, Void p) {
                return "\"" + javaString(str) + "\"";
            }

            @Override
            public String visitType(TypeMirror t, Void p) {
                return type(types.erasure(t)) + ".class";
            }

            @Override
            public String visitEnumConstant(VariableElement c, Void p) {
                return type(c.asType()) + "." + c.getSimpleName();
            }

            @Override
            public String visitAnnotation(AnnotationMirror a, Void p) {
                return annotationMirror(a);
            }

            @Override
            public String visitArray(List<? extends AnnotationValue> vals, Void p) {
                List<String> items = new ArrayList<>();
                for (AnnotationValue v : vals) items.add(annotationValue(v));
                return "{" + String.join(", ", items) + "}";
            }
        }, null);
    }

    // ---- 파일

    private void writeFile(String internalName, String source) throws IOException {
        Path file = outDir.resolve(internalName + ".java");
        Files.createDirectories(file.getParent());
        Files.write(file, source.getBytes(StandardCharsets.UTF_8));
    }

    /** 불투명 껍데기: 최상위마다 파일 하나, 필요한 중첩만 */
    private void writeOpaque() throws IOException {
        // 형식 매개변수 경계·Throwable 상위가 다른 불투명 형식을 부를 수 있다(줄어들지 않으므로 끝난다)
        Map<String, Set<String>> byTop = new TreeMap<>();
        Set<String> done = new HashSet<>();
        boolean changed = true;
        Map<String, String> bodies = new LinkedHashMap<>();
        while (changed) {
            changed = false;
            for (String name : new ArrayList<>(opaque.keySet())) {
                if (!done.add(name)) continue;
                changed = true;
                String top = topOf(name);
                byTop.computeIfAbsent(top, k -> new TreeSet<>()).add(name);
                // 바깥 형식들도
                String current = name;
                while (current.indexOf('$') > 0) {
                    current = current.substring(0, current.lastIndexOf('$'));
                    byTop.get(top).add(current);
                    opaque.computeIfAbsent(current, k -> new Opaque());
                    done.add(current);
                }
                // 경계와 상위 형식을 미리 훑어 다른 불투명 형식을 모은다
                Opaque o = opaque.get(name);
                if (o.element != null) opaqueHeader(name, o);
            }
        }
        for (Map.Entry<String, Set<String>> e : byTop.entrySet()) {
            String top = e.getKey();
            if (top.startsWith("java/")) {
                warnings.add("missing JDK type " + dotted(top) + " (cannot make an opaque stub in java.*)");
                continue;
            }
            StringBuilder out = new StringBuilder();
            String pkg = top.lastIndexOf('/') < 0 ? "" : dotted(top.substring(0, top.lastIndexOf('/')));
            out.append("// SandBot: 불투명 껍데기. 시뮬레이터에 없는 형식이라 멤버가 없다(이름·종류·형식 매개변수만).\n");
            if (!pkg.isEmpty()) out.append("package ").append(pkg).append(";\n\n");
            opaqueDeclaration(top, e.getValue(), out, "", true);
            bodies.put(top, out.toString());
            opaqueTops.add(top);
        }
        for (Map.Entry<String, String> e : bodies.entrySet()) writeFile(e.getKey(), e.getValue());
    }

    private void opaqueDeclaration(String name, Set<String> all, StringBuilder out, String indent, boolean top) {
        Opaque o = opaque.computeIfAbsent(name, k -> new Opaque());
        String simple = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('$')) + 1);
        String[] header = o.element != null ? opaqueHeader(name, o) : null;
        String kind = header != null ? header[0] : o.throwable ? "class" : o.kind;
        String typeParams = header != null ? header[1] : arityParameters(o.arity);
        String sup = header != null ? header[2] : o.throwable ? " extends java.lang.Exception" : "";
        boolean isStatic = header == null || !header[3].isEmpty();
        out.append(indent).append("public ");
        if (!top && isStatic && kind.equals("class")) out.append("static ");
        out.append(kind).append(' ').append(simple).append(typeParams).append(sup).append(" {\n");
        if (kind.equals("enum")) out.append(indent).append("    ;\n");
        if (kind.equals("class")) out.append(indent).append("    protected ").append(simple).append("() {}\n");
        for (String child : all) {
            if (child.startsWith(name + "$") && child.indexOf('$', name.length() + 1) < 0)
                opaqueDeclaration(child, all, out, indent + "    ", false);
        }
        out.append(indent).append("}\n");
    }

    private static String arityParameters(int arity) {
        if (arity == 0) return "";
        List<String> names = new ArrayList<>();
        for (int i = 0; i < arity; i++) names.add("T" + i);
        return "<" + String.join(", ", names) + ">";
    }

    /** 안드로이드 형식의 머리: [종류, 형식 매개변수, 상위(Throwable 하위만), static이면 "static"] */
    private String[] opaqueHeader(String name, Opaque o) {
        TypeElement e = o.element;
        Set<String> sink = new LinkedHashSet<>();
        Set<String> saved = wanted;
        wanted = sink;
        try {
            String kind;
            switch (e.getKind()) {
                case INTERFACE:
                    kind = "interface";
                    break;
                case ANNOTATION_TYPE:
                    kind = "@interface";
                    break;
                case ENUM:
                    kind = "enum";
                    break;
                default:
                    kind = "class";
            }
            String params = typeParameters(e.getTypeParameters());
            String sup = "";
            if (kind.equals("class") && isThrowable(e)) {
                TypeMirror s = e.getSuperclass();
                if (!isObject(s)) sup = " extends " + type(s);
            }
            boolean isStatic = e.getNestingKind() != NestingKind.MEMBER || e.getModifiers().contains(Modifier.STATIC)
                    || !kind.equals("class");
            return new String[] {kind, params, sup, isStatic ? "static" : ""};
        } finally {
            wanted = saved;
        }
    }

    private boolean isThrowable(TypeElement e) {
        TypeMirror throwable = elements.getTypeElement("java.lang.Throwable").asType();
        return types.isSubtype(types.erasure(e.asType()), types.erasure(throwable));
    }
}
