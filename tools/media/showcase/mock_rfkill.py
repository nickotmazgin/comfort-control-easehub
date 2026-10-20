#!/usr/bin/env python3
"""Stand-in for gsd-rfkill on the nested session's private D-Bus.

The nested Shell runs under dbus-run-session, where GNOME's rfkill service does
not exist, so EaseHub hides its Bluetooth and Airplane Mode tiles. This mock
answers the same interface so both tiles show up and can be toggled. It only
stores booleans in memory; no real radio is touched.
"""

from gi.repository import Gio, GLib

NAME = 'org.gnome.SettingsDaemon.Rfkill'
PATH = '/org/gnome/SettingsDaemon/Rfkill'
XML = f'''<node><interface name="{NAME}">
  <property name="AirplaneMode" type="b" access="readwrite"/>
  <property name="HardwareAirplaneMode" type="b" access="read"/>
  <property name="HasAirplaneMode" type="b" access="read"/>
  <property name="ShouldShowAirplaneMode" type="b" access="read"/>
  <property name="BluetoothAirplaneMode" type="b" access="readwrite"/>
  <property name="BluetoothHardwareAirplaneMode" type="b" access="read"/>
  <property name="BluetoothHasAirplaneMode" type="b" access="read"/>
</interface></node>'''

props = {
    'AirplaneMode': False,
    'HardwareAirplaneMode': False,
    'HasAirplaneMode': True,
    'ShouldShowAirplaneMode': True,
    'BluetoothAirplaneMode': False,
    'BluetoothHardwareAirplaneMode': False,
    'BluetoothHasAirplaneMode': True,
}
conn = None


def get_prop(_c, _s, _p, _i, name):
    return GLib.Variant('b', props[name])


def set_prop(c, _s, _p, _i, name, value):
    props[name] = value.unpack()
    c.emit_signal(None, PATH, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                  GLib.Variant('(sa{sv}as)', (NAME, {name: GLib.Variant('b', props[name])}, [])))
    return True


def on_bus(c, _name):
    global conn
    conn = c
    iface = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
    c.register_object(PATH, iface, None, get_prop, set_prop)


Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE, on_bus, None, None)
GLib.MainLoop().run()
