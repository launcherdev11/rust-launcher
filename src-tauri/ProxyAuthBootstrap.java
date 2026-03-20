import java.net.Authenticator;
import java.net.PasswordAuthentication;

/**
 * Bootstrap to enable proxy Basic auth for HTTPS tunneling (CONNECT).
 *
 * Forge installer runs in a separate JVM, so passing `-Dhttp.proxyUser/-Dhttp.proxyPassword`
 * isn't enough in many JVM versions. This class installs a default Authenticator
 * based on `-DproxyUser/-DproxyPass` system properties, then forwards args to Forge.
 */
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

        // Launch Forge installer main() with forwarded args.
        net.minecraftforge.installer.SimpleInstaller.main(args);
    }
}

