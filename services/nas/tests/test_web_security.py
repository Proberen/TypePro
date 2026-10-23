"""The credential form must remain safe even when JavaScript fails to load."""

from html.parser import HTMLParser
from pathlib import Path
import unittest


class CredentialMarkup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = []
        self.forms = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "input" and attributes.get("type") == "password":
            self.fields.append(attributes)
        if tag == "form":
            self.forms.append(attributes)


class WebSecurityTests(unittest.TestCase):
    def test_no_javascript_fallback_cannot_put_credential_in_url(self):
        markup = CredentialMarkup()
        markup.feed((Path(__file__).parents[1] / "web/index.html").read_text())
        self.assertTrue(markup.fields)
        self.assertTrue(markup.forms)
        self.assertTrue(all(not field.get("name") for field in markup.fields))
        self.assertTrue(all(form.get("method", "get").lower() == "post" for form in markup.forms))
