package main

import (
 	"context"
//    "fmt"
    "log"
    "net/http"
    "time"
	"encoding/json"
	"github.com/getlantern/systray"
    "github.com/gorilla/websocket"
)

// We'll need to define an Upgrader
// this will require a Read and Write buffer size
var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
}

func reader(conn *websocket.Conn) {
    for {
        messageType, message, err := conn.ReadMessage()
        if err != nil {
            log.Println(err)
            return
        }

        response := process_command(message)
        response_json, _ := json.Marshal(response)

        if err := conn.WriteMessage(messageType, response_json); err != nil {
            log.Println(err)
            return
        }
    }
}

func wsEndpoint(w http.ResponseWriter, r *http.Request) {
    upgrader.CheckOrigin = func(r *http.Request) bool { return true }

    ws, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Println(err)
    }

    // helpful log statement to show connections
    log.Println("Client Connected")

    reader(ws)
}

func setupRoutes() {
    http.HandleFunc("/", wsEndpoint)
}

func onReady() {
	systray.SetTitle("GPG Bridge")
	systray.SetTemplateIcon(Data, Data)

	systray.AddMenuItem("GPG Bridge", "Sign messages with local GPG")
	mQuitOrig := systray.AddMenuItem("Quit", "Quit the app")

	go func() {
		<-mQuitOrig.ClickedCh
		systray.Quit()
	}()
}

func main() {
	server := &http.Server{
		Addr: ":5151",
	}

	onExit := func() {
		shutdownCtx, shutdownRelease := context.WithTimeout(context.Background(), 10*time.Second)
        defer shutdownRelease()

		if err := server.Shutdown(shutdownCtx); err != nil {
            log.Fatalf("HTTP shutdown error: %v", err)
        }
	}

    setupRoutes()
    go func() {
        log.Fatal(server.ListenAndServe())
	}()

	systray.Run(onReady, onExit)
}

