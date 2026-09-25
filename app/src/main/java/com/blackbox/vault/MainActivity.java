package com.blackbox.vault;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private byte[] pendingExportBytes;
    private String pendingExportMime = "application/octet-stream";
    private String pendingExportName = "Blackbox-export.dat";

    private static final int FILE_CHOOSER_REQUEST = 4101;
    private static final int SAVE_FILE_REQUEST = 4102;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(0xFF090909);
        getWindow().setNavigationBarColor(0xFF090909);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF090909);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);

        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.addJavascriptInterface(new AndroidVaultBridge(), "AndroidVault");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }

                filePathCallback = callback;
                Intent intent = params.createIntent();

                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(
                            MainActivity.this,
                            "Не удалось открыть выбор файла",
                            Toast.LENGTH_SHORT
                    ).show();
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    private final class AndroidVaultBridge {
        @JavascriptInterface
        public void saveBase64File(String fileName, String mimeType, String base64Data) {
            try {
                final byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                final String safeName =
                        (fileName == null || fileName.trim().isEmpty())
                                ? "Blackbox-export.dat"
                                : fileName;
                final String safeMime =
                        (mimeType == null || mimeType.trim().isEmpty())
                                ? "application/octet-stream"
                                : mimeType;

                runOnUiThread(() -> openSaveDialog(safeName, safeMime, bytes));
            } catch (Exception e) {
                runOnUiThread(() ->
                        Toast.makeText(
                                MainActivity.this,
                                "Не удалось подготовить файл",
                                Toast.LENGTH_SHORT
                        ).show()
                );
            }
        }
    }

    private void openSaveDialog(String fileName, String mimeType, byte[] bytes) {
        pendingExportBytes = bytes;
        pendingExportMime = mimeType;
        pendingExportName = fileName;

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        try {
            startActivityForResult(intent, SAVE_FILE_REQUEST);
        } catch (Exception e) {
            pendingExportBytes = null;
            Toast.makeText(
                    this,
                    "Не удалось открыть сохранение файла",
                    Toast.LENGTH_SHORT
            ).show();
        }
    }

    private void finishExport(Intent data) {
        if (pendingExportBytes == null || data == null || data.getData() == null) {
            pendingExportBytes = null;
            return;
        }

        Uri uri = data.getData();

        try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) {
                throw new IllegalStateException("No output stream");
            }

            out.write(pendingExportBytes);
            out.flush();

            Toast.makeText(
                    this,
                    "Файл сохранён: " + pendingExportName,
                    Toast.LENGTH_LONG
            ).show();
        } catch (Exception e) {
            Toast.makeText(
                    this,
                    "Не удалось сохранить файл",
                    Toast.LENGTH_LONG
            ).show();
        } finally {
            pendingExportBytes = null;
            pendingExportMime = "application/octet-stream";
            pendingExportName = "Blackbox-export.dat";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == SAVE_FILE_REQUEST) {
            if (resultCode == RESULT_OK) {
                finishExport(data);
            } else {
                pendingExportBytes = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
