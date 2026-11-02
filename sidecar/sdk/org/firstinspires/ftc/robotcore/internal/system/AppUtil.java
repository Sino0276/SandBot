/*
Copyright (c) 2016 Robert Atkinson

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted (subject to the limitations in the disclaimer below) provided that
the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

Neither the name of Robert Atkinson nor the names of his contributors may be used to
endorse or promote products derived from this software without specific prior
written permission.

NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS
LICENSE. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
// SandBot: 폴더는 /sdcard 대신 런타임이 넣은 모의 저장소(Sim.firstFolder(), RunRequest.firstFolder)이고 ROOT_FOLDER와 FIRST_FOLDER가 같다(그 아래 폴더는 실제와 같은 이름). Android 객체(Application·Activity·Context)는 없다(null). 파일 도움 함수·버전 글자·앱 이름·failFast(SimExit)는 실제와 같고(MTP 알림 없음, 벽시계는 가상 시계), 화면·USB·블루투스·시스템 시각 설정·임시 파일·threeten 날짜 함수는 SimUnsupportedException이다. androidx 애너테이션 없음.
package org.firstinspires.ftc.robotcore.internal.system;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Application;
import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.os.Handler;
import android.os.ResultReceiver;
import android.widget.EditText;

import com.qualcomm.robotcore.BuildConfig;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.Predicate;
import org.firstinspires.ftc.robotcore.external.function.Consumer;
import org.firstinspires.ftc.robotcore.external.function.Continuation;
import org.firstinspires.ftc.robotcore.internal.network.RobotCoreCommandList;
import org.firstinspires.ftc.robotcore.internal.ui.ProgressParameters;
import org.firstinspires.ftc.robotcore.internal.ui.UILocation;
import org.firstinspires.ftc.robotcore.internal.webserver.websockets.WebSocketManager;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.sim.TimeRedirects;
import org.threeten.bp.Year;
import org.threeten.bp.YearMonth;
import org.threeten.bp.format.DateTimeFormatter;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

/**
 * {@link AppUtil} contains a few utilities related to application and activity management.
 */
@SuppressWarnings({"WeakerAccess", "JavaDoc"})
public class AppUtil
    {
    //----------------------------------------------------------------------------------------------
    // Directory management
    // See also OnBotJavaManager.
    //----------------------------------------------------------------------------------------------

    /** The root of all external storage that we use */
    // SandBot: 실제는 Environment.getExternalStorageDirectory()(/sdcard). 사이드카는 프로젝트마다의 모의 저장소(TeamCode 밖)다.
    public static final File ROOT_FOLDER = Sim.firstFolder();

    /** {@link #FIRST_FOLDER} is the root of the tree we use in non-volatile storage. Robot configurations
     * are stored in this folder. */
    // SandBot: 실제는 ROOT_FOLDER/FIRST. 사이드카는 ROOT_FOLDER와 같은 폴더다(호스트가 만든 …/FIRST).
    public static final File FIRST_FOLDER = ROOT_FOLDER;

    /** Where to place logs */
    public static final File LOG_FOLDER = ROOT_FOLDER;
    public static final File MATCH_LOG_FOLDER = new File(FIRST_FOLDER, "matchlogs");
    public static final int MAX_MATCH_LOGS_TO_KEEP = 9;

    /** Dirctory in which .xml robot configurations should live */
    public static final File CONFIG_FILES_DIR = FIRST_FOLDER;

    /** Opmodes generated by the blocks programming tool are stored in {@link #BLOCK_OPMODES_DIR} */
    public static final File BLOCK_OPMODES_DIR = new File(FIRST_FOLDER, "blocks");
    public static final String BLOCKS_BLK_EXT = ".blk";
    public static final String BLOCKS_JS_EXT = ".js";
    public static final File BLOCKS_SOUNDS_DIR = new File(BLOCK_OPMODES_DIR, "sounds");

    /** {@link #ROBOT_SETTINGS} is a folder in which it's convenient to store team-generated settings
     * associated with their robot */
    public static final File ROBOT_SETTINGS = new File(FIRST_FOLDER, "settings");

    /** {@link #ROBOT_DATA_DIR} is a convenient place in which to put persistent data created by your OpMode */
    public static final File ROBOT_DATA_DIR = new File(FIRST_FOLDER, "data");

    /** {@link #UPDATES_DIR} is a folder used to manage updates to firmware, installed APKs, and other components */
    public static final File UPDATES_DIR = new File(FIRST_FOLDER, "updates");
    public static final File RC_APP_UPDATE_DIR = new File(UPDATES_DIR, "Robot Controller Application");
    public static final File LYNX_FIRMWARE_UPDATE_DIR = new File(UPDATES_DIR, "Expansion Hub Firmware");
    public static final File OTA_UPDATE_DIR = new File(ROOT_FOLDER, "OTA-Updates");

    /** {@link #SOUNDS_DIR} is used by the SoundPlayer. {@link #SOUNDS_CACHE} is a cache of remoted sounds */
    public static final File SOUNDS_DIR = new File(FIRST_FOLDER, "sounds");
    public static final File SOUNDS_CACHE = new File(SOUNDS_DIR, "cache");

    /** Where to place webcam calibration files */
    public static final File WEBCAM_CALIBRATIONS_DIR = new File(FIRST_FOLDER, "webcamcalibrations");

    /** Progress WebSocket constants */
    public static final String PROGRESS_NAMESPACE = "progress";
    public static final String SHOW_PROGRESS_MSG = "showProgress";
    public static final String DISMISS_PROGRESS_MSG = "dismissProgress";

    //----------------------------------------------------------------------------------------------
    // Static State
    //----------------------------------------------------------------------------------------------

    public static final String TAG= "AppUtil";

    private static class InstanceHolder
        {
        public static AppUtil theInstance = new AppUtil();
        }

    public static AppUtil getInstance()
        {
        return InstanceHolder.theInstance;
        }

    public static Application getDefContext()
        {
        return getInstance().getApplication();
        }

    // SandBot: 사이드카가 시뮬레이션하지 않는 기능(화면·USB·블루투스·시스템 시각·threeten)
    private static SimUnsupportedException unsupported(String method)
        {
        return new SimUnsupportedException("org.firstinspires.ftc.robotcore.internal.system.AppUtil#" + method);
        }

    //----------------------------------------------------------------------------------------------
    // State
    //----------------------------------------------------------------------------------------------

    private final Lock          requestPermissionLock;

    //----------------------------------------------------------------------------------------------
    // Construction
    //----------------------------------------------------------------------------------------------

    public static void onApplicationStart(Application application)
        {
        throw unsupported("onApplicationStart(android.app.Application)");
        }

    protected AppUtil()
        {
        this.requestPermissionLock = new ReentrantLock();
        }

    protected void initialize(Application application)
        {
        throw unsupported("initialize(android.app.Application)");
        }

    //----------------------------------------------------------------------------------------------
    // File and Directory Management
    //----------------------------------------------------------------------------------------------

    /**
     * Given a root File and a child underneath same returns the path from the former to the latter
     */
    public File getRelativePath(File root, File child)
        {
        File result = new File("");
        while (!root.equals(child))
            {
            File parent = child.getParentFile();
            result = new File(new File(child.getName()), result.getPath());
            if (parent == null) break;
            child = parent;
            }
        return result;
        }

    /**
     * Make sure all the components of the path exist, notifying MTP if necessary for any creations
     */
    public void ensureDirectoryExists(final File directory)
        {
        ensureDirectoryExists(directory, true);
        }
    public void ensureDirectoryExists(final File directory, boolean notify)
        {
        // SandBot: MTP(USB 파일 전송) 알림은 없다(실제는 MediaTransferProtocolMonitor의 표시 파일)
        if (!directory.isDirectory())
            {
            directory.delete(); // might be a file; get rid of same

            File parent = directory.getParentFile();
            if (parent != null)
                {
                ensureDirectoryExists(parent, notify);
                }

            if (!directory.mkdir())
                {
                // already existed, or error; latter logged & ignored.
                if (!directory.isDirectory())
                    {
                    RobotLog.ee(TAG, "failed to create directory %s", directory);
                    }
                }
            }
        }

    public void deleteChildren(File file)
        {
        File[] children = file.listFiles();
        if (children != null)
            {
            for (File child : children)
                {
                delete(child);
                }
            }
        }

    /** Delete the indicated file or directory, clearing directories as needed */
    public void delete(File file)
        {
        deleteChildren(file);
        if (!file.delete())
            {
            RobotLog.ee(TAG, "failed to delete '%s'", file.getAbsolutePath());
            }
        }

    public List<File> filesUnder(File directory)
        {
        return filesUnder(directory, (Predicate<File>)null);
        }

    /** Return all the files (ie: not directories) under root for which predicate returns true */
    public List<File> filesUnder(File parent, Predicate<File> predicate)
        {
        ArrayList<File> result = new ArrayList<>();
        if (parent.isDirectory())
            {
            for (File child : parent.listFiles())
                {
                result.addAll(filesUnder(child, predicate));
                }
            }
        else if (parent.exists())
            {
            if (predicate==null || predicate.test(parent))
                {
                result.add(parent.getAbsoluteFile());
                }
            }
        return result;
        }

    public List<File> filesUnder(File parent, final String extension)
        {
        return filesUnder(parent, new Predicate<File>()
            {
            @Override public boolean test(File file)
                {
                return file.getName().endsWith(extension);
                }
            });
        }

    public List<File> filesIn(File directory)
        {
        return filesIn(directory, (Predicate<File>)null);
        }

    public List<File> filesIn(File directory, Predicate<File> predicate)
        {
        ArrayList<File> result = new ArrayList<>();
        File[] children = directory.listFiles();
        if (children != null)
            {
            for (File child : children)
                {
                if (predicate==null || predicate.test(child))
                    {
                    result.add(child.getAbsoluteFile());
                    }
                }
            }
        return result;
        }

    public List<File> filesIn(File directory, final String extension)
        {
        return filesIn(directory, new Predicate<File>()
            {
            @Override public boolean test(File file)
                {
                return file.getName().endsWith(extension);
                }
            });
        }

    public File getSettingsFile(String filename)
        {
        File file = new File(filename);
        if (!file.isAbsolute())
            {
            ensureDirectoryExists(ROBOT_SETTINGS);
            file = new File(ROBOT_SETTINGS, filename);
            }
        return file;
        }

    public void copyFile(File fromFile, File toFile) throws IOException
        {
        InputStream inputStream = new FileInputStream(fromFile);
        try {
            copyStream(inputStream, toFile);
            }
        finally
            {
            inputStream.close();
            }
        }

    public void copyStream(InputStream inputStream, File toFile) throws IOException
        {
        OutputStream outputStream = new FileOutputStream(toFile);
        try
            {
            copyStream(inputStream, outputStream);
            }
        finally
            {
            outputStream.close();
            }
        }

    public void copyStream(File inputFile, OutputStream outputStream) throws IOException
        {
        InputStream inputStream = new FileInputStream(inputFile);
        try {
            copyStream(inputStream, outputStream);
            }
        finally
            {
            inputStream.close();
            }
        }

    public void copyStream(InputStream inputStream, OutputStream outputStream) throws IOException
        {
        int cbBuffer = Math.min(4096, inputStream.available());
        byte[] buffer = new byte[cbBuffer];
        for (;;)
            {
            int cbRead = inputStream.read(buffer);
            if (cbRead <= 0) break;
            outputStream.write(buffer, 0, cbRead);
            }
        }

    // SandBot: 임시 파일·폴더 이름은 난수라 실행마다 달라진다(결정성 밖)
    public File createTempFile(String prefix, String suffix, File directory) throws IOException
        {
        throw unsupported("createTempFile(java.lang.String,java.lang.String,java.io.File)");
        }

    public File createTempDirectory(String prefix, String suffix, File directory) throws IOException
        {
        throw unsupported("createTempDirectory(java.lang.String,java.lang.String,java.io.File)");
        }

    public String getUsbFileSystemRoot()
        {
        throw unsupported("getUsbFileSystemRoot()");
        }

    public String getNonNullUsbFileSystemRoot()
        {
        throw unsupported("getNonNullUsbFileSystemRoot()");
        }

    public void setUsbFileSystemRoot(UsbDevice usbDevice)
        {
        throw unsupported("setUsbFileSystemRoot(android.hardware.usb.UsbDevice)");
        }

    protected static String usbFileSystemRootFromDeviceName(String usbDeviceName)
        {
        throw unsupported("usbFileSystemRootFromDeviceName(java.lang.String)");
        }

    protected void setUsbFileSystemRoot(String usbFileSystemRoot)
        {
        throw unsupported("setUsbFileSystemRoot(java.lang.String)");
        }

    protected void notifyUsbListeners(String usbFileSystemRoot)
        {
        throw unsupported("notifyUsbListeners(java.lang.String)");
        }

    public void addUsbfsListener(UsbFileSystemRootListener listener)
        {
        throw unsupported("addUsbfsListener(org.firstinspires.ftc.robotcore.internal.system.AppUtil$UsbFileSystemRootListener)");
        }

    public void removeUsbfsListener(UsbFileSystemRootListener listener)
        {
        throw unsupported("removeUsbfsListener(org.firstinspires.ftc.robotcore.internal.system.AppUtil$UsbFileSystemRootListener)");
        }

    public interface UsbFileSystemRootListener
        {
        void onUsbFileSystemRootChanged(String usbFileSystemRoot);
        }

    public static String computeMd5(File file) throws NoSuchAlgorithmException, IOException
        {
        InputStream inputStream = new FileInputStream(file);
        try {
            MessageDigest digest = java.security.MessageDigest.getInstance("MD5");
            byte[] buffer = new byte[256];
            for (;;)
                {
                int cbRead = inputStream.read(buffer);
                if (cbRead < 0)
                    break;
                digest.update(buffer, 0, cbRead);
                }
            byte[] hash = digest.digest();
            StringBuilder result = new StringBuilder();
            for (int ib = 0; ib < hash.length; ib++)
                {
                result.append(String.format(Locale.ROOT, "%02x", hash[ib]));
                }
            return result.toString();
            }
        finally
            {
            inputStream.close();
            }
        }

    //----------------------------------------------------------------------------------------------
    // Life Cycle
    //----------------------------------------------------------------------------------------------

    /**
     * Restarts the current application
     * @param exitCode the exit code to return from the current app run
     */
    public void restartApp(int exitCode)
        {
        throw unsupported("restartApp(int)");
        }

    public void exitApplication(int resultCode)
        {
        RobotLog.vv(TAG, new RuntimeException(), "exitApplication(%d) was called. Printing stacktrace.", resultCode);
        // SandBot: System.exit 대신 SimExit(패치한 팀 코드의 System.exit와 같이 런타임이 OpMode를 끝낸 것으로 본다)
        TimeRedirects.exit(resultCode);
        }

    public void exitApplication()
        {
        exitApplication(0);
        }

    //----------------------------------------------------------------------------------------------
    // Application
    //----------------------------------------------------------------------------------------------

    /**
     * Returns the contextually running {@link Application}
     * @return the contextually running {@link Application}
     */
    public Application getApplication()
        {
        // SandBot: Android 앱이 없다
        return null;
        }

    /**
     * Returns the application id of this current application, the identifier
     * that distinguishes it from all other applications. This is the 'packageName' in
     * the ultimately-shipped manifest, but that differs from the 'packageName' attribute
     * in the source AndroidManifest.xml.
     *
     * @see <a href="https://developer.android.com/studio/build/application-id.html">Application Id</a>
     */
    public String getApplicationId()
        {
        // SandBot: Robot Controller 앱의 id(RobotCore 리소스 packageNameRobotController)
        return "com.qualcomm.ftcrobotcontroller";
        }

    // SandBot: 사이드카는 Robot Controller다(이름은 RobotCore의 영어 리소스 appNameRobotController·appNameDriverStation)
    public boolean isRobotController()
        {
        return true;
        }

    public boolean isDriverStation()
        {
        return false;
        }

    public String getAppName()
        {
        return "Robot Controller";
        }

    public String getRemoteAppName()
        {
        return "Driver Station";
        }

    public static String getSdkVersionString(int majorSdkVersion, int minorSdkVersion, int pointSdkVersion)
        {
        return String.format(Locale.US, "%d.%d.%d", majorSdkVersion, minorSdkVersion, pointSdkVersion);
        }

    public static String getSdkVersionString()
        {
        return getSdkVersionString(BuildConfig.SDK_MAJOR_VERSION, BuildConfig.SDK_MINOR_VERSION, BuildConfig.SDK_POINT_VERSION);
        }

    //----------------------------------------------------------------------------------------------
    // General UI interaction
    //----------------------------------------------------------------------------------------------

    public static int getColor(int id)
        {
        throw unsupported("getColor(int)");
        }

    public void synchronousRunOnUiThread(final Runnable action)
        {
        throw unsupported("synchronousRunOnUiThread(java.lang.Runnable)");
        }

    public void synchronousRunOnUiThread(Activity activity, final Runnable action)
        {
        throw unsupported("synchronousRunOnUiThread(android.app.Activity,java.lang.Runnable)");
        }

    public void runOnUiThread(final Runnable action)
        {
        throw unsupported("runOnUiThread(java.lang.Runnable)");
        }

    public void runOnUiThread(Activity activity, final Runnable action)
        {
        throw unsupported("runOnUiThread(android.app.Activity,java.lang.Runnable)");
        }

    public void showWaitCursor(final String message, final Runnable runnable)
        {
        throw unsupported("showWaitCursor(java.lang.String,java.lang.Runnable)");
        }

    public void showWaitCursor(final String message, final Runnable backgroundWorker, final Runnable runPostOnUIThread)
        {
        throw unsupported("showWaitCursor(java.lang.String,java.lang.Runnable,java.lang.Runnable)");
        }

    public void setWebSocketManager(WebSocketManager webSocketManager)
        {
        throw unsupported("setWebSocketManager(org.firstinspires.ftc.robotcore.internal.webserver.websockets.WebSocketManager)");
        }

    public void showProgress(UILocation uiLocation, final String message, final double fractionComplete)
        {
        throw unsupported("showProgress(org.firstinspires.ftc.robotcore.internal.ui.UILocation,java.lang.String,double)");
        }

    public void showProgress(UILocation uiLocation, final String message, final double fractionComplete, int max)
        {
        throw unsupported("showProgress(org.firstinspires.ftc.robotcore.internal.ui.UILocation,java.lang.String,double,int)");
        }

    public void showProgress(UILocation uiLocation, final String message, ProgressParameters progressParameters)
        {
        throw unsupported("showProgress(org.firstinspires.ftc.robotcore.internal.ui.UILocation,java.lang.String,org.firstinspires.ftc.robotcore.internal.ui.ProgressParameters)");
        }

    public void showProgress(UILocation uiLocation, final Activity activity, final String message, final ProgressParameters progressParameters)
        {
        throw unsupported("showProgress(org.firstinspires.ftc.robotcore.internal.ui.UILocation,android.app.Activity,java.lang.String,org.firstinspires.ftc.robotcore.internal.ui.ProgressParameters)");
        }

    public void dismissProgress(UILocation uiLocation)
        {
        throw unsupported("dismissProgress(org.firstinspires.ftc.robotcore.internal.ui.UILocation)");
        }

    public void asyncRequestUsbPermission(String tag, Context modalContext, UsbDevice usbDevice, Deadline deadline, Handler handler, Consumer<Boolean> resultReport)
        {
        throw unsupported("asyncRequestUsbPermission(java.lang.String,android.content.Context,android.hardware.usb.UsbDevice,org.firstinspires.ftc.robotcore.internal.system.Deadline,android.os.Handler,org.firstinspires.ftc.robotcore.external.function.Consumer)");
        }

    public void asyncRequestUsbPermission(String tag, Context modalContext, UsbDevice usbDevice, Deadline deadline, ExecutorService threadPool, Consumer<Boolean> resultReport)
        {
        throw unsupported("asyncRequestUsbPermission(java.lang.String,android.content.Context,android.hardware.usb.UsbDevice,org.firstinspires.ftc.robotcore.internal.system.Deadline,java.util.concurrent.ExecutorService,org.firstinspires.ftc.robotcore.external.function.Consumer)");
        }

    public void asyncRequestUsbPermission(
            final String tag,
            final Context modalContext,
            final UsbDevice usbDevice,
            final Deadline deadline,
            final Continuation<? extends Consumer<Boolean>> continuation)
        {
        throw unsupported("asyncRequestUsbPermission(java.lang.String,android.content.Context,android.hardware.usb.UsbDevice,org.firstinspires.ftc.robotcore.internal.system.Deadline,org.firstinspires.ftc.robotcore.external.function.Continuation)");
        }

    //----------------------------------------------------------------------------------------------
    // Alert / Confirm / Prompt Dialog
    // https://developer.android.com/guide/topics/ui/dialogs.html
    //----------------------------------------------------------------------------------------------

    public enum DialogFlavor { ALERT, CONFIRM, PROMPT }

    public static class DialogContext
        {
        public enum Outcome { UNKNOWN, CANCELLED, CONFIRMED }

        public final CountDownLatch dismissed = new CountDownLatch(1);

        protected final String         uuidString;
        protected AlertDialog          dialog;
        protected boolean              isArmed = true;
        protected Outcome              outcome = Outcome.UNKNOWN;
        protected CharSequence         textResult = null;
        protected EditText             input = null;

        public DialogContext(String uuidString)
            {
            this.uuidString = uuidString;
            }

        public Outcome getOutcome()
            {
            return outcome;
            }

        public CharSequence getText()
            {
            return textResult;
            }

        // Dismiss the dialog if it hasn't been dismissed already
        public void dismissDialog()
            {
            throw unsupported("DialogContext.dismissDialog()");
            }
        }

    public static class DialogParams extends MemberwiseCloneable<DialogParams>
        {
        public UILocation       uiLocation;
        public String           title;
        public String           message;
        public DialogFlavor     flavor         = DialogFlavor.ALERT;
        public Activity         activity       = AppUtil.getInstance().getActivity();
        public String           defaultValue   = null;
        public String           uuidString     = null;

        public DialogParams(UILocation uiLocation, String title, String message)
            {
            this.uiLocation = uiLocation;
            this.title = title;
            this.message = message;
            }

        public DialogParams copy()
            {
            return super.memberwiseClone();
            }
        }

    public DialogContext showAlertDialog(UILocation uiLocation, String title, String message)
        {
        throw unsupported("showAlertDialog(org.firstinspires.ftc.robotcore.internal.ui.UILocation,java.lang.String,java.lang.String)");
        }

    public DialogContext showDialog(DialogParams params)
        {
        throw unsupported("showDialog(org.firstinspires.ftc.robotcore.internal.system.AppUtil$DialogParams)");
        }

    public DialogContext showDialog(DialogParams params, Consumer<DialogContext> runOnDismiss)
        {
        throw unsupported("showDialog(org.firstinspires.ftc.robotcore.internal.system.AppUtil$DialogParams,org.firstinspires.ftc.robotcore.external.function.Consumer)");
        }

    public DialogContext showDialog(DialogParams params, Handler handler, Consumer<DialogContext> runOnDismiss)
        {
        throw unsupported("showDialog(org.firstinspires.ftc.robotcore.internal.system.AppUtil$DialogParams,android.os.Handler,org.firstinspires.ftc.robotcore.external.function.Consumer)");
        }

    public DialogContext showDialog(DialogParams params, Executor threadPool, Consumer<DialogContext> runOnDismiss)
        {
        throw unsupported("showDialog(org.firstinspires.ftc.robotcore.internal.system.AppUtil$DialogParams,java.util.concurrent.Executor,org.firstinspires.ftc.robotcore.external.function.Consumer)");
        }

    public DialogContext showDialog(DialogParams params, final Continuation<? extends Consumer<DialogContext>> runOnDismiss)
        {
        throw unsupported("showDialog(org.firstinspires.ftc.robotcore.internal.system.AppUtil$DialogParams,org.firstinspires.ftc.robotcore.external.function.Continuation)");
        }

    public void dismissDialog(UILocation uiLocation, RobotCoreCommandList.DismissDialog dismissDialog)
        {
        throw unsupported("dismissDialog(org.firstinspires.ftc.robotcore.internal.ui.UILocation,org.firstinspires.ftc.robotcore.internal.network.RobotCoreCommandList$DismissDialog)");
        }

    protected void dismissDialog(final String uuidString)
        {
        throw unsupported("dismissDialog(java.lang.String)");
        }

    public void dismissAllDialogs(UILocation uiLocation)
        {
        throw unsupported("dismissAllDialogs(org.firstinspires.ftc.robotcore.internal.ui.UILocation)");
        }

    public void showToast(UILocation uiLocation, String msg)
        {
        throw unsupported("showToast(org.firstinspires.ftc.robotcore.internal.ui.UILocation,java.lang.String)");
        }

    public void showToast(final UILocation uiLocation, final String msg, final int duration)
        {
        throw unsupported("showToast(org.firstinspires.ftc.robotcore.internal.ui.UILocation,java.lang.String,int)");
        }

    @Deprecated
    public void showToast(UILocation uiLocation, Context context, String msg )
        {
        throw unsupported("showToast(org.firstinspires.ftc.robotcore.internal.ui.UILocation,android.content.Context,java.lang.String)");
        }

    @Deprecated
    public void showToast(UILocation uiLocation, final Activity activity, Context context, String msg)
        {
        throw unsupported("showToast(org.firstinspires.ftc.robotcore.internal.ui.UILocation,android.app.Activity,android.content.Context,java.lang.String)");
        }

    @Deprecated
    public void showToast(UILocation uiLocation, final Activity activity, final Context context, final String msg, final int duration)
        {
        throw unsupported("showToast(org.firstinspires.ftc.robotcore.internal.ui.UILocation,android.app.Activity,android.content.Context,java.lang.String,int)");
        }

    //----------------------------------------------------------------------------------------------
    // Activities
    //----------------------------------------------------------------------------------------------

    /**
     * Returns the contextually running {@link Activity}. This should RARELY be null, but might
     * possibly be if we currently are only running services
     * @return the contextually running {@link Activity}
     */
    public Activity getActivity()
        {
        // SandBot: Android 화면이 없다
        return null;
        }

    /**
     * Returns an appropriate context against which to launch modal dialogs, etc.
     * @return
     */
    public Context getModalContext()
        {
        // SandBot: 실제는 지금 Activity, 없으면 Application. 둘 다 없다.
        return null;
        }

    /**
     * Returns the root activity of the current application
     * @return the root activity of the current application
     */
    public Activity getRootActivity()
        {
        return null;
        }

    //----------------------------------------------------------------------------------------------
    // Bluetooth management
    //----------------------------------------------------------------------------------------------

    public void setBluetoothEnabled(boolean enable)
        {
        throw unsupported("setBluetoothEnabled(boolean)");
        }

    //----------------------------------------------------------------------------------------------
    // Date and time
    //----------------------------------------------------------------------------------------------

    public DateTimeFormatter getIso8601DateTimeFormatter()
        {
        throw unsupported("getIso8601DateTimeFormatter()");
        }

    public DateTimeFormatter getLocalIso8601DateTimeFormatter()
        {
        throw unsupported("getLocalIso8601DateTimeFormatter()");
        }

    public YearMonth getYearMonthFromIso8601(String timeString)
        {
        throw unsupported("getYearMonthFromIso8601(java.lang.String)");
        }

    public YearMonth getLocalSdkBuildMonth()
        {
        throw unsupported("getLocalSdkBuildMonth()");
        }

    public Year getFtcSeasonYear(YearMonth month)
        {
        throw unsupported("getFtcSeasonYear(org.threeten.bp.YearMonth)");
        }

    public boolean appIsObsolete(YearMonth sdkBuildMonth)
        {
        throw unsupported("appIsObsolete(org.threeten.bp.YearMonth)");
        }

    public boolean localAppIsObsolete()
        {
        throw unsupported("localAppIsObsolete()");
        }

    /**
     * Returns the current system wall clock time.
     */
    public long getWallClockTime()
        {
        // SandBot: 가상 시계(팀 코드의 System.currentTimeMillis와 같다)
        return TimeRedirects.currentTimeMillis();
        }

    // SandBot: 실제는 Control Hub에서 시스템 시각을 바꾼다. 사이드카의 시계는 가상 시계다.
    public void setWallClockTime(long millis)
        {
        throw unsupported("setWallClockTime(long)");
        }

    /**
     * Attempts to atomically set the timezone and clock returned by {@link #getWallClockTime()},
     * if we know that the currently set time cannot be correct.
     *
     * W/o a modified Android kernel, this will be unsuccessful, due to a check in
     * kernel/security/commoncap.c. On the Control Hub, that has been disabled. Note that no error
     * is reported on failure.
     *
     * Note that this attempts to set the timezone and current time for the whole system,
     * not just this process.
     */
    public void setWallClockIfCurrentlyInsane(long timeMillis, String timezone)
        {
        boolean timeCurrentlySane = isSaneWallClockTime(getWallClockTime());
        boolean acceptableTimezone = (timezone != null && !timezone.isEmpty());
        if (!timeCurrentlySane && isSaneWallClockTime(timeMillis) && acceptableTimezone)
            {
            setWallClockTime(timeMillis);
            setTimeZone(timezone);
            }
        }

    public void setTimeZone(String timeZone)
        {
        throw unsupported("setTimeZone(java.lang.String)");
        }

    /**
     * Is the indicated time one that could reasonably exist for a robot controller or a driver station?
     * What we're really trying to do here is to detect systems that have no battery-backed-up
     * clock on board. Those, on boot, will start counting from the Unix epoch, which is in 1970.
     */
    public boolean isSaneWallClockTime(long millis)
        {
        GregorianCalendar calendar = new GregorianCalendar();
        calendar.setTimeInMillis(millis);
        return calendar.get(GregorianCalendar.YEAR) > 1975;
        }

    //----------------------------------------------------------------------------------------------
    // System
    //----------------------------------------------------------------------------------------------

    /** Warning: calling this method can be very expensive, due to the
     * need to create stack traces. Do not use in production code. */
    public String findCaller(String message, int frameOffset)
        {
        StackTraceElement element = (new RuntimeException()).getStackTrace()[2+frameOffset]; // 2 is one for RuntimeException, one for our own caller.
        String fullClassName = element.getClassName();
        String callingClass = fullClassName.substring(fullClassName.lastIndexOf('.')+1);
        String fileName = new File(element.getFileName()).getName();
        int line = element.getLineNumber();
        return Misc.formatInvariant("%s caller=[%s:%d] %s", message, fileName, line, callingClass);
        }

    public RuntimeException unreachable()
        {
        return unreachable(TAG);
        }

    public RuntimeException unreachable(Throwable throwable)
        {
        return unreachable(TAG, throwable);
        }

    public RuntimeException unreachable(String tag)
        {
        return failFast(tag, "internal error: this code is unreachable");
        }

    public RuntimeException unreachable(String tag, Throwable throwable)
        {
        return failFast(tag, throwable, "internal error: this code is unreachable");
        }

    public RuntimeException failFast(String tag, String format, Object... args)
        {
        String message = String.format(format, args);
        return failFast(tag, message);
        }

    public RuntimeException failFast(String tag, String message)
        {
        RobotLog.ee(tag, message);
        exitApplication(-1);
        return new RuntimeException("keep compiler happy");
        }

    public RuntimeException failFast(String tag, Throwable throwable, String format, Object... args)
        {
        String message = String.format(format, args);
        return failFast(tag, throwable, message);
        }

    public RuntimeException failFast(String tag, Throwable throwable, String message)
        {
        RobotLog.ee(tag, throwable, message);
        exitApplication(-1);
        return new RuntimeException("keep compiler happy", throwable);
        }

    //----------------------------------------------------------------------------------------------
    // Inter-Process Communication
    //----------------------------------------------------------------------------------------------

    public static ResultReceiver wrapResultReceiverForIpc(ResultReceiver actualReceiver)
        {
        throw unsupported("wrapResultReceiverForIpc(android.os.ResultReceiver)");
        }

    }
