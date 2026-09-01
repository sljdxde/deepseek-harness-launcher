import Foundation

func formatLogTimestamp(_ date: Date = Date(), timeZone: TimeZone = .current) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
    return formatter.string(from: date)
}
