import Foundation
import AppKit

@main
struct BrowserConnectionTests {
    static func main() {
        let sample = """
        p2043
        n127.0.0.1:59072->127.0.0.1:3080
        n127.0.0.1:59073->127.0.0.1:3080
        p43799
        n127.0.0.1:3080->127.0.0.1:59072
        p9
        n127.0.0.1:60000->127.0.0.1:30800
        p10
        n[::1]:60000->[::1]:3080
        p11
        n192.168.1.2:60000->192.168.1.3:3080
        pbad
        n127.0.0.1:59074->127.0.0.1:3080
        """
        precondition(BrowserConnectionSupport.clientPIDs(sample, port: 3080) == [2043, 10])
        precondition(BrowserConnectionSupport.clientPIDs("", port: 3080).isEmpty)
        precondition(BrowserConnectionSupport.clientPIDs(sample, port: 3081).isEmpty)
        let parents: [Int32: Int32] = [2043: 1847, 1847: 1, 20: 21, 21: 20, 30: 31]
        let apps: [Int32: String] = [1847: "com.google.Chrome", 31: "com.apple.Terminal"]
        precondition(BrowserConnectionSupport.browserPID(start: 2043, parents: parents, applications: apps) == 1847)
        precondition(BrowserConnectionSupport.browserPID(start: 1847, parents: parents, applications: apps) == 1847)
        precondition(BrowserConnectionSupport.browserPID(start: 20, parents: parents, applications: apps) == nil)
        precondition(BrowserConnectionSupport.browserPID(start: 30, parents: parents, applications: apps) == nil)
        precondition(BrowserConnectionSupport.browserPID(start: 99, parents: parents, applications: apps) == nil)
        print("PASS: connection direction, exact port, IPv6, deduplication, malformed records, helper ancestry, cycles, non-browser exclusion")
    }
}
