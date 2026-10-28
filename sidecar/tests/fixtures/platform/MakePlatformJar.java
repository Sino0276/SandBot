import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 시험용 플랫폼 jar(라이브러리 L1 갈래 D의 시험 지원, 갈래 A의 sidecar/build/test-platform.jar가 없을 때): 실행 중인 JDK의
 * jrt:/java.base에서 java/**·javax/** 클래스만 담은 jar를 만든다. Android 플랫폼 API(android.jar)처럼 javac -bootclasspath로 쓴다.
 * 사용: java MakePlatformJar.java &lt;out.jar&gt;
 */
public final class MakePlatformJar {
    public static void main(String[] args) throws IOException {
        FileSystem jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        Path base = jrt.getPath("/modules/java.base");
        List<Path> files = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(base)) {
            walk.filter(Files::isRegularFile).forEach(files::add);
        }
        Collections.sort(files);
        Path out = Paths.get(args[0]);
        Path temp = out.resolveSibling(out.getFileName() + ".tmp");
        int count = 0;
        try (OutputStream stream = Files.newOutputStream(temp); ZipOutputStream zip = new ZipOutputStream(stream)) {
            for (Path file : files) {
                String name = base.relativize(file).toString();
                if (!name.endsWith(".class") || !(name.startsWith("java/") || name.startsWith("javax/"))) continue;
                ZipEntry entry = new ZipEntry(name);
                entry.setTime(0);
                zip.putNextEntry(entry);
                zip.write(Files.readAllBytes(file));
                zip.closeEntry();
                count++;
            }
        }
        Files.move(temp, out, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        System.out.println("classes=" + count);
    }
}
