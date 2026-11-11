import struct, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
data = open("build/DHL.exe", "rb").read()
start = data.find("VS_VERSION_INFO".encode("utf-16-le")) - 6
wLength, wValueLength, wType = struct.unpack_from("<HHH", data, start)
blob = data[start:start + wLength]
for i in range(0, min(len(blob), 192), 16):
    chunk = blob[i:i + 16]
    hexs = " ".join("%02x" % b for b in chunk)
    try:
        txt = chunk.decode("utf-16-le", errors="backslashreplace")
    except Exception:
        txt = ""
    print("%04x  %s  %s" % (i, hexs, txt))
