# RadioHub · provider interface. GPL-3.0-or-later.
#
# A provider knows how to talk to a family of radios. The engine keeps one
# active provider per session and every RPC goes through it, so the app's
# screens, backups and review step are the same for every radio.
#
# Channels cross the engine boundary in one "unified" shape:
#   number, empty, name, freq (MHz), duplex ('', '+', '-', 'split', 'off'),
#   offset (MHz), tmode ('', 'Tone', 'TSQL', 'DTCS'), rtone, ctone, dtcs,
#   dtcs_polarity, mode ('FM', 'NFM', 'AM', 'DMR', ...), power, skip, comment
# and, only on digital channels:
#   dmr: {color_code 0-15, time_slot 'TS1'|'TS2', contact, group_list, radio_id}
# Digital codeplug collections (contacts, group lists, zones, radio IDs) are
# exposed separately through get_extras / set_extras.


class ProviderError(Exception):
    """An error the user should read (already in Portuguese)."""


class Provider(object):
    name = 'base'

    def summary(self):
        raise NotImplementedError

    def get_memories(self, bounds=None):
        raise NotImplementedError

    def set_memories(self, mems):
        raise NotImplementedError

    def validate(self, mems):
        raise NotImplementedError

    def erase_all(self):
        raise NotImplementedError

    def save(self, path):
        raise NotImplementedError

    def upload(self, port, backups_dir, status_fn):
        raise NotImplementedError

    def get_extras(self):
        return {}

    def set_extras(self, extras):
        return {}
