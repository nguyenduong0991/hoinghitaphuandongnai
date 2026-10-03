# Hệ thống quản lý hội nghị TGPL Đồng Nai

Giao diện hỗ trợ đăng ký, điều phối và theo dõi hội nghị trợ giúp pháp lý.

## Chạy trên máy tính

Yêu cầu Node.js 18 trở lên. Mở terminal tại thư mục dự án và chạy:

```sh
npm start
```

Sau đó mở http://localhost:8080. Ứng dụng lưu dữ liệu trong trình duyệt đang sử dụng; dữ liệu còn lại sau khi tải lại trang nhưng không tự chia sẻ với trình duyệt hoặc người dùng khác.

## Đưa giao diện lên GitHub Pages

Có thể xuất bản các tệp HTML, CSS và JavaScript này bằng GitHub Pages. Không cần chạy `server.js` trên Pages. Mỗi người dùng sẽ có vùng lưu trữ riêng trong trình duyệt của họ.

Để nhiều người dùng cùng xem và cập nhật một bộ dữ liệu, cần triển khai một API và cơ sở dữ liệu dùng chung, sau đó đặt `window.TGPL_API_BASE_URL` trước khi tải `assets/js/api.js`. Repository hiện chưa chứa dịch vụ API hoặc cấu hình cơ sở dữ liệu.
