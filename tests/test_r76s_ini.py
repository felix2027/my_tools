import re
import unittest
from pathlib import Path


CONFIG = Path(__file__).resolve().parents[1] / "config"
REGIONS = ("TW", "SG", "JP", "US", "HK", "Other")


def values(lines, key):
    return [line[len(key) + 1:] for line in lines if line.startswith(key + "=")]


class R76sIniTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lines = (CONFIG / "proxy_config_r76s.ini").read_text(encoding="utf-8").splitlines()
        cls.groups = {}
        for row in values(cls.lines, "custom_proxy_group"):
            name, *options = row.split("`")
            cls.groups[name] = options

    def test_region_priority_and_coverage(self):
        # Include ambiguous labels and names that contain a country code inside a word.
        cases = [
            ("TW01 via HK02", "TW"), ("🇸🇬-03", "SG"), ("東京 JP", "JP"),
            ("美西", "US"), ("RUSSIA", "Other"), ("AUSTRALIA", "Other"),
            ("吉隆坡", "Other"), ("Node-TW", "TW"), ("Node-Other", "Other"),
        ]
        for i, region in enumerate(REGIONS[:-1]):
            for other in REGIONS[i + 1:-1]:
                cases.append((f"{other}-via-{region}", region))
        for name, expected in cases:
            with self.subTest(name=name):
                matches = [r for r in REGIONS if re.search(self.groups[r][1], name)]
                self.assertEqual(matches, [expected])

    def test_failover_checks_regions_and_never_defaults_to_direct(self):
        for name in REGIONS:
            kind, _, empty_region, _, interval = self.groups[name]
            self.assertEqual((kind, empty_region, interval), ("url-test", "[]REJECT", "600,,150"))
        for name in ("Fallback", "TW_HK_Fallback", "Auto", "LoadBalance"):
            regions = ("TW", "HK") if name == "TW_HK_Fallback" else REGIONS
            self.assertEqual(self.groups[name][1:-2], ["[]" + r for r in regions])
        self.assertEqual(self.groups["Proxies"][1], "[]Fallback")
        self.assertEqual(self.groups["Manual"][1], "[]Fallback")
        pattern, _ = values(self.lines, "rename")[0].split("@")
        for reserved in [*self.groups, "DIRECT", "REJECT"]:
            self.assertRegex(reserved, pattern)

    def test_private_routes_precede_the_next_business_rules(self):
        rules = values(self.lines, "ruleset")
        self.assertEqual(rules[:3], [
            f"DIRECT,[]IP-CIDR,{cidr},no-resolve"
            for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        ])
        base = (CONFIG / "proxy_config_next.ini").read_text(encoding="utf-8").splitlines()
        self.assertEqual(rules[3:], values(base, "ruleset"))


if __name__ == "__main__":
    unittest.main()
