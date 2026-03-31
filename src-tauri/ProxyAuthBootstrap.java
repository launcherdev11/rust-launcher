import java.net.Authenticator;
import java.net.PasswordAuthentication;

public class ProxyAuthBootstrap {
    public static void main(String[] args) throws Exception {
        String proxyUser = System.getProperty("proxyUser");
        String proxyPass = System.getProperty("proxyPass");

        String proxyHost = System.getProperty("http.proxyHost");

        boolean hasAuth = proxyUser != null && proxyPass != null;

        if (hasAuth) {
            System.out.println(
                "[ProxyAuthBootstrap] Proxy auth enabled. Proxy host=" + proxyHost + ", user set=" + (proxyUser != null)
            );
            Authenticator.setDefault(new Authenticator() {
                @Override
                protected PasswordAuthentication getPasswordAuthentication() {
                    return new PasswordAuthentication(proxyUser, proxyPass.toCharArray());
                }
            });
        } else {
            System.out.println("[ProxyAuthBootstrap] Proxy auth not configured (missing proxyUser/proxyPass).");
        }

        Class<?> installerClass = Class.forName("net.minecraftforge.installer.SimpleInstaller");
        java.lang.reflect.Method mainMethod = installerClass.getMethod("main", String[].class);
        mainMethod.invoke(null, (Object) args);
    }
}

