import os
from ldap3 import Server, Connection, SIMPLE, NONE
from ldap3.utils.conv import escape_filter_chars


LDAP_MATCHING_RULE_IN_CHAIN = "1.2.840.113556.1.4.1941"


def get_ad_settings():
    return {
        "host": os.getenv("AD_HOST", "10.1.1.19"),
        "port": int(os.getenv("AD_PORT", "389")),
        "use_ssl": os.getenv("AD_USE_SSL", "false").lower() == "true",
        "domain": os.getenv("AD_DOMAIN", "IPEA.GOV.BR"),
        "base_dn": os.getenv("AD_BASE_DN", "DC=ipea,DC=gov,DC=br"),
        "group_cn": os.getenv("AD_GROUP_CN", "GestaoAD"),
    }


def authenticate_ad_user(username: str, password: str):
    if not username or not password:
        raise ValueError("Usuário e senha são obrigatórios")

    cfg = get_ad_settings()

    server = Server(
        host=cfg["host"],
        port=cfg["port"],
        use_ssl=cfg["use_ssl"],
        get_info=NONE,
    )

    bind_user = f"{username}@{cfg['domain']}"
    conn = Connection(
        server,
        user=bind_user,
        password=password,
        authentication=SIMPLE,
        auto_bind=True,
    )

    try:
        safe_group_cn = escape_filter_chars(cfg["group_cn"])
        safe_username = escape_filter_chars(username)

        group_filter = f"(&(objectClass=group)(cn={safe_group_cn}))"
        conn.search(
            search_base=cfg["base_dn"],
            search_filter=group_filter,
            attributes=["distinguishedName", "cn"],
        )

        if not conn.entries:
            raise ValueError("Grupo autorizado não encontrado no AD")

        group_dn = str(conn.entries[0].distinguishedName.value)

        user_filter = (
            f"(&(objectClass=user)"
            f"(sAMAccountName={safe_username})"
            f"(memberOf:{LDAP_MATCHING_RULE_IN_CHAIN}:={group_dn}))"
        )

        conn.search(
            search_base=cfg["base_dn"],
            search_filter=user_filter,
            attributes=[
                "distinguishedName",
                "displayName",
                "mail",
                "sAMAccountName",
                "cn",
                "memberOf",
            ],
        )

        if not conn.entries:
            raise PermissionError("Usuário não autorizado para acessar a plataforma")

        entry = conn.entries[0]

        return {
            "username": str(entry.sAMAccountName.value) if entry.sAMAccountName.value else username,
            "display_name": str(entry.displayName.value) if entry.displayName.value else str(entry.cn.value),
            "email": str(entry.mail.value) if entry.mail.value else None,
            "dn": str(entry.distinguishedName.value),
            "ad_group": cfg["group_cn"],
        }
    finally:
        conn.unbind()
