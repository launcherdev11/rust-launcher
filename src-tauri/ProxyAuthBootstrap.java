import java.net.Authenticator;
import java.net.PasswordAuthentication;

public class ProxyAuthBootstrap {
    public static void main(String[] args) throws Exception {
        String proxyUser = firstNonEmpty(
            System.getenv("MC16_PROXY_USER"),
            System.getenv("PROXY_USER")
        );
        String proxyPass = firstNonEmpty(
            System.getenv("MC16_PROXY_PASS"),
            System.getenv("PROXY_PASS")
        );

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
            System.out.println("[ProxyAuthBootstrap] Proxy auth not configured (missing proxy credentials env).");
        }

        Class<?> installerClass = Class.forName("net.minecraftforge.installer.SimpleInstaller");
        java.lang.reflect.Method mainMethod = installerClass.getMethod("main", String[].class);
        mainMethod.invoke(null, (Object) args);
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return null;
    }
}
